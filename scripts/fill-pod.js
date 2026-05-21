const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Configuration
const FIXTURES_DIR = path.join(__dirname, "../desktop/src/specs/integration/file/fixtures");
const DEFAULT_POD_ROOT_URL = process.env.POD_ROOT_URL || "http://localhost:3000/test";
const CONTENT_TYPE = "application/vnd.ant.fit";

// Available activity types (based on directory structure)
const AVAILABLE_TYPES = ["cycling", "running", "swimming", "others"];

function normalizeUrl(url) {
  return url.replace(/\/+$/, "");
}

function getRawActivitiesUrl(podRootUrl) {
  return `${normalizeUrl(podRootUrl)}/raw-activities`;
}

function getActivitiesUrl(podRootUrl) {
  return `${normalizeUrl(podRootUrl)}/activities`;
}

/**
 * Get all FIT files from a directory
 * @param {string} dirPath - Path to the directory
 * @returns {string[]} Array of file paths
 */
function getFitFiles(dirPath) {
  const files = [];

  try {
    const items = fs.readdirSync(dirPath);

    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      const stat = fs.statSync(itemPath);

      if (stat.isDirectory()) {
        files.push(...getFitFiles(itemPath));
      } else if (item.toLowerCase().endsWith(".fit")) {
        files.push(itemPath);
      }
    }
  } catch (error) {
    console.warn(`Warning: Could not read directory ${dirPath}: ${error.message}`);
  }

  return files;
}

/**
 * Upload a file to the Solid pod using curl
 * @param {string} filePath - Local file path
 * @param {string} fileName - Name for the file on the pod
 */
function uploadFile(filePath, fileName, rawActivitiesUrl) {
  const podUrl = `${rawActivitiesUrl}/${fileName}`;
  const curlCommand = `curl -X PUT -T "${filePath}" "${podUrl}" -H "Content-Type: ${CONTENT_TYPE}"`;

  try {
    console.log(`Uploading ${fileName}...`);
    execSync(curlCommand, { stdio: "pipe" });
    console.log(`✓ Successfully uploaded ${fileName}`);
    return true;
  } catch (error) {
    console.error(`✗ Failed to upload ${fileName}: ${error.message}`);
    return false;
  }
}

/**
 * Read all resources listed by a Solid container.
 * @param {string} containerUrl - URL to the Solid container
 * @returns {string[]} Resource URLs contained by the container
 */
function getContainerResources(containerUrl) {
  const normalizedContainerUrl = `${normalizeUrl(containerUrl)}/`;
  const curlCommand = `curl -fsSL "${normalizedContainerUrl}" -H "Accept: text/turtle"`;

  try {
    const turtle = execSync(curlCommand, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    const resources = new Set();
    const containsPredicates = turtle.matchAll(/(?:ldp:contains|<http:\/\/www\.w3\.org\/ns\/ldp#contains>)/g);

    for (const predicateMatch of containsPredicates) {
      const start = predicateMatch.index + predicateMatch[0].length;
      const statementEnd = [turtle.indexOf(" .", start), turtle.indexOf(" ;", start)]
        .filter(index => index >= 0)
        .sort((a, b) => a - b)[0];
      const objectList = turtle.slice(start, statementEnd >= 0 ? statementEnd : undefined);
      const iriMatches = objectList.matchAll(/<([^>]+)>/g);
      for (const iriMatch of iriMatches) {
        resources.add(new URL(iriMatch[1], normalizedContainerUrl).toString());
      }
    }

    return Array.from(resources);
  } catch (error) {
    console.warn(`Warning: Could not read container ${normalizedContainerUrl}: ${error.message}`);
    return [];
  }
}

/**
 * Delete generated activity RDF documents so raw files are processed again.
 * @param {string} podRootUrl - Root URL of the test pod storage
 */
function clearGeneratedActivities(podRootUrl) {
  const activitiesUrl = getActivitiesUrl(podRootUrl);
  const resources = getContainerResources(activitiesUrl);

  if (resources.length === 0) {
    console.log(`No generated activity documents found in ${activitiesUrl}`);
    return;
  }

  console.log(`Deleting ${resources.length} generated activity document(s) from ${activitiesUrl}...`);
  for (const resource of resources) {
    try {
      execSync(`curl -fsS -X DELETE "${resource}"`, { stdio: "pipe" });
      console.log(`✓ Deleted ${resource}`);
    } catch (error) {
      console.error(`✗ Failed to delete ${resource}: ${error.message}`);
    }
  }
}

/**
 * Get files for specified activity types with limits
 * @param {string[]} types - Array of activity types to include
 * @param {number} maxPerType - Maximum number of files per type
 * @param {number} maxTotal - Maximum total number of files across all types
 * @returns {Object} Object with type as key and array of files as value
 */
function getFilesByType(types, maxPerType = Infinity, maxTotal = Infinity) {
  const filesByType = {};
  let totalFilesCollected = 0;

  for (const type of types) {
    const typePath = path.join(FIXTURES_DIR, type);

    if (!fs.existsSync(typePath)) {
      console.warn(`Warning: Directory ${type} does not exist`);
      continue;
    }

    const files = getFitFiles(typePath);

    // Calculate how many files we can take from this type
    const remainingTotal = maxTotal - totalFilesCollected;
    const maxFromThisType = Math.min(maxPerType, remainingTotal);

    filesByType[type] = files.slice(0, maxFromThisType);
    totalFilesCollected += filesByType[type].length;

    console.log(`Found ${files.length} FIT files in ${type} (using ${filesByType[type].length})`);

    // Stop if we've reached the total limit
    if (totalFilesCollected >= maxTotal) {
      break;
    }
  }

  return filesByType;
}

/**
 * Find a specific file by name across all activity type directories
 * @param {string} fileName - Name of the file to find (e.g., 'cycling_noroeste.fit' or 'noroeste.fit')
 * @returns {string|null} Full path to the file if found, null otherwise
 */
function findFileByName(fileName) {
  // Remove any path prefix and ensure we're looking for a .fit file
  const cleanFileName = path.basename(fileName);
  const searchName = cleanFileName.toLowerCase().endsWith(".fit") ? cleanFileName : `${cleanFileName}.fit`;

  // Also try without any type prefix (e.g., 'noroeste.fit' from 'cycling_noroeste.fit')
  const withoutPrefix = searchName.replace(/^(cycling|running|swimming|others)_/i, "");

  console.log(`Searching for file: ${searchName} (or ${withoutPrefix})`);

  for (const type of AVAILABLE_TYPES) {
    const typePath = path.join(FIXTURES_DIR, type);

    if (!fs.existsSync(typePath)) {
      continue;
    }

    const files = getFitFiles(typePath);

    for (const filePath of files) {
      const baseName = path.basename(filePath).toLowerCase();

      // Check for exact match or match without type prefix
      if (baseName === searchName.toLowerCase() || baseName === withoutPrefix.toLowerCase()) {
        console.log(`Found file: ${filePath}`);
        return filePath;
      }
    }
  }

  console.error(`File not found: ${fileName}`);
  console.log("Available files:");

  // Show available files for reference
  for (const type of AVAILABLE_TYPES) {
    const typePath = path.join(FIXTURES_DIR, type);
    if (fs.existsSync(typePath)) {
      const files = getFitFiles(typePath);
      if (files.length > 0) {
        console.log(`  ${type}:`);
        files.forEach(file => {
          console.log(`    ${path.basename(file)}`);
        });
      }
    }
  }

  return null;
}

/**
 * Upload a specific file by name
 * @param {string} fileName - Name of the file to upload
 * @returns {boolean} True if successful, false otherwise
 */
function uploadSpecificFile(fileName, rawActivitiesUrl) {
  const filePath = findFileByName(fileName);

  if (!filePath) {
    return false;
  }

  // Determine the activity type from the file path
  const relativePath = path.relative(FIXTURES_DIR, filePath);
  const activityType = relativePath.split(path.sep)[0];

  const baseFileName = path.basename(filePath);
  const podFileName = `${activityType}_${baseFileName}`;

  console.log(`Uploading specific file: ${baseFileName} as ${podFileName}`);

  return uploadFile(filePath, podFileName, rawActivitiesUrl);
}

/**
 * Upload multiple specific files by name
 * @param {string[]} fileNames - Array of file names to upload
 * @returns {Object} Object with success and failed counts
 */
function uploadSpecificFiles(fileNames, rawActivitiesUrl) {
  let successCount = 0;
  let failedCount = 0;
  const results = [];

  console.log(`Found ${fileNames.length} file(s) to upload:`);
  fileNames.forEach(name => console.log(`  - ${name}`));
  console.log("");

  for (const fileName of fileNames) {
    console.log(`\n--- Processing: ${fileName} ---`);
    const filePath = findFileByName(fileName);

    if (!filePath) {
      console.error(`✗ Skipping ${fileName}: file not found`);
      failedCount++;
      results.push({ fileName, success: false, reason: "File not found" });
      continue;
    }

    // Determine the activity type from the file path
    const relativePath = path.relative(FIXTURES_DIR, filePath);
    const activityType = relativePath.split(path.sep)[0];

    const baseFileName = path.basename(filePath);
    const podFileName = `${activityType}_${baseFileName}`;

    console.log(`Uploading: ${baseFileName} as ${podFileName}`);

    if (uploadFile(filePath, podFileName, rawActivitiesUrl)) {
      successCount++;
      results.push({ fileName, success: true, podFileName });
    } else {
      failedCount++;
      results.push({ fileName, success: false, reason: "Upload failed" });
    }
  }

  return { successCount, failedCount, results };
}

/**
 * Main function to upload files to pod
 */
function main() {
  const args = process.argv.slice(2);

  // Parse command line arguments
  let types = [];
  let maxPerType = Infinity;
  let maxSpecified = null;
  let specificFile = null;
  let podRootUrl = DEFAULT_POD_ROOT_URL;
  let clearActivities = false;
  let showHelp = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      showHelp = true;
      break;
    } else if (arg === "--file" || arg === "-f") {
      if (i + 1 < args.length) {
        specificFile = args[i + 1];
        i++;
      }
    } else if (arg === "--types" || arg === "-t") {
      if (i + 1 < args.length) {
        types = args[i + 1].split(",").map(t => t.trim().toLowerCase());
        i++;
      }
    } else if (arg === "--max" || arg === "-m") {
      if (i + 1 < args.length) {
        maxSpecified = parseInt(args[i + 1]);
        i++;
      }
    } else if (arg === "--pod-root") {
      if (i + 1 < args.length) {
        podRootUrl = args[i + 1];
        i++;
      }
    } else if (arg === "--clear-activities") {
      clearActivities = true;
    }
  }

  podRootUrl = normalizeUrl(podRootUrl);
  const rawActivitiesUrl = getRawActivitiesUrl(podRootUrl);

  if (showHelp) {
    console.log(`
Usage: node fill-pod.js [options]

Options:
  --file, -f <filename>  Upload specific file(s) by name. Multiple files can be separated by commas.
                         Examples: 'cycling_noroeste.fit' or 'noroeste.fit,marathon.fit,pool_swim.fit'
                         This option takes precedence over other options

  --types, -t <types>    Comma-separated list of activity types to upload
                         Available: ${AVAILABLE_TYPES.join(",")}
                         Default: all types

  --max, -m <number>     Maximum number of files to upload
                         When types are specified: max per type
                         When no types specified: max total across all types

  --pod-root <url>       Root URL of the pod storage
                         Default: ${DEFAULT_POD_ROOT_URL}

  --clear-activities     Delete generated RDF documents from /activities before uploading raw files.
                         Use after ontology changes so the app recomputes activities.

  --help, -h             Show this help message

Examples:
  node fill-pod.js --file cycling_noroeste.fit                    (upload single specific file)
  node fill-pod.js -f noroeste.fit,marathon.fit,pool_swim.fit     (upload multiple specific files)
  node fill-pod.js --types cycling,running --max 5               (5 files per type)
  node fill-pod.js --max 10                                      (10 files total)
  node fill-pod.js -t cycling -m 10                              (10 cycling files)
  node fill-pod.js --clear-activities --max 10                   (regenerate RDF for 10 raw files)
  node fill-pod.js                                               (all files)
`);
    return;
  }

  if (clearActivities) {
    clearGeneratedActivities(podRootUrl);
    console.log("");
  }

  // Handle specific file upload(s)
  if (specificFile) {
    // Parse comma-separated file names
    const fileNames = specificFile
      .split(",")
      .map(name => name.trim())
      .filter(name => name.length > 0);

    console.log(`Uploading specific file(s): ${fileNames.join(", ")}`);
    console.log(`Pod URL: ${rawActivitiesUrl}`);
    console.log("");

    if (fileNames.length === 1) {
      // Single file - use existing logic for backward compatibility
      const success = uploadSpecificFile(fileNames[0], rawActivitiesUrl);

      // Print upload summary for specific file
      console.log(`\n--- Upload Summary ---`);
      if (success) {
        console.log(`✓ Successfully uploaded: 1 file`);
        console.log(`✗ Failed uploads: 0 files`);
      } else {
        console.log(`✓ Successfully uploaded: 0 files`);
        console.log(`✗ Failed uploads: 1 file`);
        process.exit(1);
      }
      console.log(`Total processed: 1 file`);
    } else {
      // Multiple files - use new logic
      const result = uploadSpecificFiles(fileNames, rawActivitiesUrl);

      // Print detailed upload summary for multiple files
      console.log(`\n--- Upload Summary ---`);
      console.log(`✓ Successfully uploaded: ${result.successCount} files`);
      console.log(`✗ Failed uploads: ${result.failedCount} files`);
      console.log(`Total processed: ${fileNames.length} files`);

      // Show details of failed uploads if any
      if (result.failedCount > 0) {
        console.log(`\nFailed uploads:`);
        result.results
          .filter(r => !r.success)
          .forEach(r => {
            console.log(`  ✗ ${r.fileName}: ${r.reason}`);
          });
        process.exit(1);
      }
    }
    return;
  }

  // Determine limits based on whether types were specified
  let maxTotal = Infinity;

  if (maxSpecified !== null) {
    if (types.length === 0) {
      // No types specified: max applies to total across all types
      maxTotal = maxSpecified;
      maxPerType = Infinity;
    } else {
      // Types specified: max applies per type
      maxPerType = maxSpecified;
    }
  }

  // Default to all types if none specified
  if (types.length === 0) {
    types = AVAILABLE_TYPES;
  }

  // Validate types
  const invalidTypes = types.filter(type => !AVAILABLE_TYPES.includes(type));
  if (invalidTypes.length > 0) {
    console.error(`Error: Invalid activity types: ${invalidTypes.join(", ")}`);
    console.error(`Available types: ${AVAILABLE_TYPES.join(", ")}`);
    process.exit(1);
  }

  console.log(`Starting upload process...`);
  console.log(`Activity types: ${types.join(", ")}`);
  if (maxSpecified !== null && types.length > 0 && maxTotal === Infinity) {
    console.log(`Max per type: ${maxPerType}`);
  } else if (maxTotal !== Infinity) {
    console.log(`Max total: ${maxTotal}`);
  } else {
    console.log(`Max per type: unlimited`);
  }
  console.log(`Pod URL: ${rawActivitiesUrl}`);
  console.log("");

  // Get files by type
  const filesByType = getFilesByType(types, maxPerType, maxTotal);

  // Upload files
  let totalUploaded = 0;
  let totalFailed = 0;

  for (const [type, files] of Object.entries(filesByType)) {
    console.log(`\n--- Uploading ${type} files ---`);

    for (const filePath of files) {
      const fileName = path.basename(filePath);
      const podFileName = `${type}_${fileName}`;

      if (uploadFile(filePath, podFileName, rawActivitiesUrl)) {
        totalUploaded++;
      } else {
        totalFailed++;
      }
    }
  }

  console.log(`\n--- Upload Summary ---`);
  console.log(`✓ Successfully uploaded: ${totalUploaded} files`);
  console.log(`✗ Failed uploads: ${totalFailed} files`);
  console.log(`Total processed: ${totalUploaded + totalFailed} files`);
}

// Run the script
if (require.main === module) {
  main();
}
