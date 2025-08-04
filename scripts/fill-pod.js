const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const FIXTURES_DIR = path.join(__dirname, '../desktop/src/specs/integration/file/fixtures');
const POD_BASE_URL = 'http://localhost:3000/test/raw-activities';
const CONTENT_TYPE = 'application/vnd.ant.fit';

// Available activity types (based on directory structure)
const AVAILABLE_TYPES = ['cycling', 'running', 'swimming', 'others'];

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
      } else if (item.toLowerCase().endsWith('.fit')) {
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
function uploadFile(filePath, fileName) {
  const podUrl = `${POD_BASE_URL}/${fileName}`;
  const curlCommand = `curl -X PUT -T "${filePath}" "${podUrl}" -H "Content-Type: ${CONTENT_TYPE}"`;

  try {
    console.log(`Uploading ${fileName}...`);
    execSync(curlCommand, { stdio: 'pipe' });
    console.log(`✓ Successfully uploaded ${fileName}`);
    return true;
  } catch (error) {
    console.error(`✗ Failed to upload ${fileName}: ${error.message}`);
    return false;
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
 * Main function to upload files to pod
 */
function main() {
  const args = process.argv.slice(2);

  // Parse command line arguments
  let types = [];
  let maxPerType = Infinity;
  let maxSpecified = null;
  let showHelp = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      showHelp = true;
      break;
    } else if (arg === '--types' || arg === '-t') {
      if (i + 1 < args.length) {
        types = args[i + 1].split(',').map(t => t.trim().toLowerCase());
        i++;
      }
    } else if (arg === '--max' || arg === '-m') {
      if (i + 1 < args.length) {
        maxSpecified = parseInt(args[i + 1]);
        i++;
      }
    }
  }

  if (showHelp) {
    console.log(`
Usage: node fill-pod.js [options]

Options:
  --types, -t <types>    Comma-separated list of activity types to upload
                         Available: ${AVAILABLE_TYPES.join(',')}
                         Default: all types

  --max, -m <number>     Maximum number of files to upload
                         When types are specified: max per type
                         When no types specified: max total across all types

  --help, -h             Show this help message

Examples:
  node fill-pod.js --types cycling,running --max 5    (5 files per type)
  node fill-pod.js --max 10                           (10 files total)
  node fill-pod.js -t cycling -m 10                   (10 cycling files)
  node fill-pod.js                                    (all files)
`);
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
    console.error(`Error: Invalid activity types: ${invalidTypes.join(', ')}`);
    console.error(`Available types: ${AVAILABLE_TYPES.join(', ')}`);
    process.exit(1);
  }

  console.log(`Starting upload process...`);
  console.log(`Activity types: ${types.join(', ')}`);
  if (maxSpecified !== null && types.length > 0 && maxTotal === Infinity) {
    console.log(`Max per type: ${maxPerType}`);
  } else if (maxTotal !== Infinity) {
    console.log(`Max total: ${maxTotal}`);
  } else {
    console.log(`Max per type: unlimited`);
  }
  console.log(`Pod URL: ${POD_BASE_URL}`);
  console.log('');

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

      if (uploadFile(filePath, podFileName)) {
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
