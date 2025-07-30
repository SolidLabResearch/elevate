// curl -X PUT -T file.fit http://localhost:3000/test/raw-activities/file.fit -H "Content-Type: application/vnd.ant.fit"
// This script reads a folder for .fit files and uploads them
// to the server using HTTP PUT requests
const fs = require('fs');
const path = require('path');
const http = require('http');

const folderPath = '/home/maarten/Documents/doctoraat/code/elevate/desktop/src/specs/integration/file/fixtures'
const fileLimit = process.argv[2] ? parseInt(process.argv[2], 10) : null;

async function getFitFiles(dir) {
  let results = [];
  const list = await fs.promises.readdir(dir);
  for (let file of list) {
    const filePath = path.join(dir, file);
    const stat = await fs.promises.stat(filePath);
    if (stat.isDirectory()) {
      const res = await getFitFiles(filePath);
      results = results.concat(res);
    } else if (path.extname(file).toLowerCase() === '.fit') {
      results.push(filePath);
    }
  }
  return results;
}

function uploadFile(filePath) {
  const fileName = path.basename(filePath);
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: `/test/raw-activities/${fileName}`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/vnd.ant.fit'
    }
  };

  const req = http.request(options, (res) => {
    console.log(`Uploaded ${fileName}: Status ${res.statusCode}`);
    res.on('data', () => {}); // consume data if any
  });

  req.on('error', (err) => {
    console.error(`Error uploading ${fileName}: ${err.message}`);
  });

  const readStream = fs.createReadStream(filePath);
  readStream.on('error', (err) => {
    console.error(`Error reading ${fileName}: ${err.message}`);
    req.end();
  });

  // Pipe the file stream to the HTTP request
  readStream.pipe(req);
}

async function run() {
  try {
    const fitFiles = await getFitFiles(folderPath);
    if (fitFiles.length === 0) {
      console.log(`No .fit files found in folder: ${folderPath}`);
      return;
    }
    // If a valid file limit is provided, slice the array
    const filesToUpload = fileLimit && !isNaN(fileLimit) ? fitFiles.slice(0, fileLimit) : fitFiles;
    for (const filePath of filesToUpload) {
      uploadFile(filePath);
    }
  } catch (error) {
    console.error(`Error processing files: ${error.message}`);
  }
}

run();
