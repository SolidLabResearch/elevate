import { Auth } from "/vendor/trustflows-client/dist/index.js";

const issuerInput = document.getElementById("issuer");
const loginButton = document.getElementById("loginButton");
const logoutButton = document.getElementById("logoutButton");
const webIdValue = document.getElementById("webId");
const podRootValue = document.getElementById("podRoot");
const clearActivitiesInput = document.getElementById("clearActivities");
const fileInput = document.getElementById("fileInput");
const dropZone = document.getElementById("dropZone");
const fileSummary = document.getElementById("fileSummary");
const generateCountInput = document.getElementById("generateCount");
const generateSportInput = document.getElementById("generateSport");
const generateDurationInput = document.getElementById("generateDuration");
const generatePowerInput = document.getElementById("generatePower");
const generateSeedInput = document.getElementById("generateSeed");
const generateFitButton = document.getElementById("generateFitButton");
const uploadButton = document.getElementById("uploadButton");
const clearSelectionButton = document.getElementById("clearSelectionButton");
const filesList = document.getElementById("files");
const emptyState = document.getElementById("emptyState");
const totalSize = document.getElementById("totalSize");
const serverStatus = document.getElementById("serverStatus");
const uploadSummary = document.getElementById("uploadSummary");
const uploadSummaryTitle = document.getElementById("uploadSummaryTitle");
const uploadSummaryText = document.getElementById("uploadSummaryText");

const CONTENT_TYPE = "application/vnd.ant.fit";
const RAW_ACTIVITY_CONTAINER_PATH = "/raw-activities/";
const GENERATED_ACTIVITY_CONTAINER_PATH = "/activities/";

const auth = new Auth({
  persistTokens: true,
  fetch: window.fetch.bind(window)
});
const authFetch = auth.createAuthFetch();

let selectedFiles = [];
let fileStates = [];
let uploading = false;
let handlingAuth = false;
let config = {
  defaultIssuerUrl: "http://localhost:3000",
  clientIdUrl: `${window.location.origin}/client-id.jsonld`
};

function setStatus(text, mode = "") {
  serverStatus.textContent = text;
  serverStatus.className = `status-pill ${mode}`.trim();
}

function formatSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function fitFilesFromList(files) {
  return Array.from(files).filter(file => file.name.toLowerCase().endsWith(".fit"));
}

function fileKey(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function setSelectedFiles(files) {
  const nextFiles = [...selectedFiles];
  const nextStates = [...fileStates];
  const known = new Set(nextFiles.map(fileKey));

  for (const file of files) {
    const key = fileKey(file);
    if (!known.has(key)) {
      nextFiles.push(file);
      nextStates.push({ state: "", text: "Queued", percent: 0 });
      known.add(key);
    }
  }

  selectedFiles = nextFiles;
  fileStates = nextStates;
  hideUploadSummary();
  renderFiles();
}

function renderFiles() {
  filesList.textContent = "";
  emptyState.hidden = selectedFiles.length > 0;
  uploadButton.disabled = uploading || selectedFiles.length === 0 || !getPodRoot();
  clearSelectionButton.disabled = uploading || selectedFiles.length === 0;
  generateFitButton.disabled = uploading;
  fileSummary.textContent =
    selectedFiles.length === 0
      ? "No files selected"
      : `${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"} selected`;
  totalSize.textContent = formatSize(selectedFiles.reduce((total, file) => total + file.size, 0));

  selectedFiles.forEach((file, index) => {
    const item = document.createElement("li");
    item.className = "file-row";
    item.dataset.index = String(index);

    const name = document.createElement("div");
    name.className = "file-name";
    name.textContent = file.name;

    const size = document.createElement("div");
    size.className = "file-size";
    size.textContent = formatSize(file.size);

    const status = document.createElement("div");
    status.className = "file-status";
    const fileState = fileStates[index] || { state: "", text: "Queued", percent: 0 };
    if (fileState.state) {
      item.classList.add(fileState.state);
    }

    status.innerHTML = '<span class="status-text"></span><div class="meter"><span></span></div>';
    status.querySelector(".status-text").textContent = fileState.text;
    status.querySelector(".meter span").style.width = `${Math.max(0, Math.min(100, fileState.percent || 0))}%`;

    item.append(name, size, status);
    filesList.append(item);
  });
}

function hideUploadSummary() {
  uploadSummary.hidden = true;
  uploadSummary.classList.remove("failed");
  uploadSummaryTitle.textContent = "";
  uploadSummaryText.textContent = "";
}

function showUploadSummary(total, failed) {
  const uploaded = total - failed;
  const allUploaded = failed === 0;
  uploadSummary.hidden = false;
  uploadSummary.classList.toggle("failed", !allUploaded);
  uploadSummaryTitle.textContent = allUploaded ? "All files uploaded" : "Upload finished with failures";
  uploadSummaryText.textContent = allUploaded
    ? `${uploaded} ${uploaded === 1 ? "file was" : "files were"} uploaded to ${RAW_ACTIVITY_CONTAINER_PATH}.`
    : `${uploaded} uploaded, ${failed} failed. Failed rows are marked in the list.`;
}

function getGenerateOptions() {
  return {
    count: generateCountInput.value,
    sport: generateSportInput.value,
    durationMinutes: generateDurationInput.value,
    intervalSeconds: 5,
    power: generatePowerInput.value,
    seed: generateSeedInput.value.trim() || String(Date.now())
  };
}

function generateFitFiles() {
  if (uploading) {
    return;
  }

  try {
    const files = window.FitGenerator.createRandomFitFiles(getGenerateOptions());
    setSelectedFiles(files);
    setStatus(`${files.length} generated`);
  } catch (error) {
    setStatus("Generate error", "error");
    alert(error.message);
  }
}

function updateRow(index, state, text, percent = null) {
  fileStates[index] = {
    state,
    text,
    percent: percent === null ? fileStates[index]?.percent || 0 : percent
  };

  const row = filesList.querySelector(`[data-index="${index}"]`);

  if (!row) {
    return;
  }

  row.classList.remove("done", "failed");
  if (state) {
    row.classList.add(state);
  }

  row.querySelector(".status-text").textContent = text;

  if (percent !== null) {
    row.querySelector(".meter span").style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }
}

function normalizeUrl(value) {
  return value.replace(/\/+$/, "");
}

function getCurrentRedirectUri() {
  const redirectUri = new URL(window.location.href);
  redirectUri.search = "";
  redirectUri.hash = "";
  return redirectUri.toString();
}

function getPodRoot() {
  if (!auth.webId) {
    return null;
  }

  return normalizeUrl(auth.webId.replace("/profile/card#me", ""));
}

function getContainerUrl(path) {
  return `${getPodRoot()}${path}`;
}

function buildUploadFileName(fileName) {
  const stem = fileName.replace(/\.[^/.]+$/, "");
  const normalizedStem = stem
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const safeStem = normalizedStem.length > 0 ? normalizedStem : "activity";
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${uniqueSuffix}-${safeStem}.fit`;
}

async function refreshAuthState() {
  let isLoggedIn = false;

  try {
    isLoggedIn = await auth.isLoggedIn();
  } catch (error) {
    isLoggedIn = false;
  }

  const podRoot = getPodRoot();
  webIdValue.textContent = auth.webId || "Not logged in";
  podRootValue.textContent = podRoot || "Not available";
  loginButton.disabled = handlingAuth || isLoggedIn;
  logoutButton.disabled = handlingAuth || !isLoggedIn;
  issuerInput.disabled = handlingAuth || isLoggedIn;
  renderFiles();

  if (!uploading && !handlingAuth) {
    setStatus(isLoggedIn ? "Ready" : "Log in");
  }
}

async function loadConfig() {
  const response = await fetch("/api/config");
  if (!response.ok) {
    throw new Error(`Unable to read local config: ${response.status}`);
  }

  config = await response.json();
  issuerInput.value = config.defaultIssuerUrl || issuerInput.value;
}

async function handleIncomingRedirect() {
  handlingAuth = true;

  try {
    const handled = await auth.handleIncomingRedirect();
    if (handled) {
      setStatus("Logged in");
    }
  } finally {
    handlingAuth = false;
    await refreshAuthState();
  }
}

async function login() {
  const issuer = issuerInput.value.trim();
  if (!issuer) {
    alert("Solid issuer is required.");
    return;
  }

  handlingAuth = true;
  setStatus("Logging in", "busy");
  await refreshAuthState();

  try {
    await auth.login(issuer, config.clientIdUrl, getCurrentRedirectUri());
  } catch (error) {
    handlingAuth = false;
    setStatus("Login error", "error");
    await refreshAuthState();
    alert(error.message);
  }
}

async function logout() {
  handlingAuth = true;
  setStatus("Logging out", "busy");
  await refreshAuthState();

  try {
    await auth.logout(getCurrentRedirectUri());
    setStatus("Logged out");
  } catch (error) {
    auth.clearCache();
    setStatus("Logged out");
  } finally {
    handlingAuth = false;
    await refreshAuthState();
  }
}

async function ensureContainerExists(containerUrl) {
  const getResponse = await authFetch(containerUrl, { method: "GET" });
  if (getResponse.ok) {
    return;
  }

  const putResponse = await authFetch(containerUrl, { method: "PUT" });
  if (putResponse.ok || putResponse.status === 409 || putResponse.status === 412) {
    return;
  }

  throw new Error(
    `Failed to create Solid container at ${containerUrl}: ${putResponse.status} ${putResponse.statusText}`
  );
}

async function ensureUploadContainer() {
  if (!getPodRoot()) {
    throw new Error("Log in before uploading activities.");
  }

  await ensureContainerExists(getContainerUrl(RAW_ACTIVITY_CONTAINER_PATH));
}

async function uploadFile(file, index) {
  const fileName = buildUploadFileName(file.name);
  const podUrl = `${getContainerUrl(RAW_ACTIVITY_CONTAINER_PATH)}${encodeURIComponent(fileName)}`;

  updateRow(index, "", "Uploading", 35);
  const response = await authFetch(podUrl, {
    method: "PUT",
    headers: {
      "Content-Type": CONTENT_TYPE
    },
    body: await file.arrayBuffer()
  });

  if (!response.ok) {
    const message = `Upload failed with ${response.status} ${response.statusText}`;
    updateRow(index, "failed", message, 100);
    throw new Error(message);
  }

  updateRow(index, "done", "Uploaded", 100);
  return { fileName, podUrl };
}

function extractContainedResources(turtle, containerUrl) {
  const normalizedContainerUrl = `${normalizeUrl(containerUrl)}/`;
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
}

async function clearGeneratedActivities() {
  const containerUrl = getContainerUrl(GENERATED_ACTIVITY_CONTAINER_PATH);
  const container = await authFetch(containerUrl, {
    method: "GET",
    headers: {
      Accept: "text/turtle"
    }
  });

  if (container.status === 404) {
    return { deleted: 0, failed: 0, failures: [] };
  }

  if (!container.ok) {
    throw new Error(`Pod responded with ${container.status} while reading generated activities`);
  }

  const resources = extractContainedResources(await container.text(), containerUrl);
  const failures = [];
  let deleted = 0;

  for (const resource of resources) {
    const response = await authFetch(resource, { method: "DELETE" });

    if (response.ok) {
      deleted++;
    } else {
      failures.push({
        resource,
        statusCode: response.status,
        message: await response.text().catch(() => "")
      });
    }
  }

  return { deleted, failed: failures.length, failures };
}

async function uploadSelectedFiles() {
  if (uploading || selectedFiles.length === 0) {
    return;
  }

  uploading = true;
  uploadButton.disabled = true;
  clearSelectionButton.disabled = true;
  hideUploadSummary();
  setStatus("Preparing", "busy");

  try {
    await ensureUploadContainer();

    if (clearActivitiesInput.checked) {
      setStatus("Clearing", "busy");
      await clearGeneratedActivities();
    }

    setStatus("Uploading", "busy");

    let failed = 0;
    const total = selectedFiles.length;
    for (let index = 0; index < selectedFiles.length; index++) {
      updateRow(index, "", "Uploading", 0);

      try {
        await uploadFile(selectedFiles[index], index);
      } catch (error) {
        failed++;
      }
    }

    setStatus(failed === 0 ? "Done" : `${failed} failed`, failed === 0 ? "" : "error");
    showUploadSummary(total, failed);
  } catch (error) {
    setStatus("Error", "error");
    alert(error.message);
  } finally {
    uploading = false;
    uploadButton.disabled = selectedFiles.length === 0 || !getPodRoot();
    clearSelectionButton.disabled = selectedFiles.length === 0;
    generateFitButton.disabled = false;
  }
}

fileInput.addEventListener("change", event => {
  setSelectedFiles(fitFilesFromList(event.target.files));
  fileInput.value = "";
});

dropZone.addEventListener("dragover", event => {
  event.preventDefault();
  dropZone.classList.add("dragging");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragging");
});

dropZone.addEventListener("drop", event => {
  event.preventDefault();
  dropZone.classList.remove("dragging");
  setSelectedFiles(fitFilesFromList(event.dataTransfer.files));
});

loginButton.addEventListener("click", () => {
  login().catch(error => {
    handlingAuth = false;
    setStatus("Login error", "error");
    refreshAuthState();
    alert(error.message);
  });
});

logoutButton.addEventListener("click", () => {
  logout().catch(error => {
    handlingAuth = false;
    setStatus("Logout error", "error");
    refreshAuthState();
    alert(error.message);
  });
});

uploadButton.addEventListener("click", uploadSelectedFiles);
generateFitButton.addEventListener("click", generateFitFiles);

clearSelectionButton.addEventListener("click", () => {
  selectedFiles = [];
  fileStates = [];
  hideUploadSummary();
  renderFiles();
  setStatus(getPodRoot() ? "Ready" : "Log in");
});

loadConfig()
  .then(handleIncomingRedirect)
  .then(refreshAuthState)
  .catch(error => {
    setStatus("Error", "error");
    alert(error.message);
  });
