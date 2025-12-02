import { register } from "/assets/@teamhanko/hanko-elements/dist/elements.js";

const { hanko } = await register(window.HANKO_API_URL);

let username = null;

// Listen for session changes and reload page
hanko.onSessionCreated(() => {
  window.location.reload();
});

hanko.onSessionExpired(() => {
  window.location.href = '/';
});

hanko.onUserDeleted(() => {
  window.location.href = '/';
});

const token = await hanko.getSessionToken();
if (!token) {
  window.location.href = '/';
} else {
  const user = await hanko.getUser();
  username = user.username;
  document.getElementById('username').textContent = username;
  loadFiles(token);
}

async function loadFiles(token) {
  const res = await fetch('/api/files', {
    credentials: 'include'
  });
  
  if (!res.ok) {
    document.getElementById('tree').textContent = 'Failed to load files';
    return;
  }
  
  const files = await res.json();
  renderTree(files, token);
}

function formatSize(bytes) {
  if (bytes === 0) return '[0B]';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return '[' + (bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1) + sizes[i] + ']';
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function getFileIcon(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  
  // Images
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'avif', 'heic', 'heif', 'bmp', 'tiff', 'tif'].includes(ext)) {
    return '🖼️';
  }
  
  // Video
  if (['mp4', 'webm', 'mov', 'qt', 'ogv'].includes(ext)) {
    return '🎬';
  }
  
  // Audio
  if (['mp3', 'wav', 'ogg', 'mid', 'midi'].includes(ext)) {
    return '🎵';
  }
  
  // Archives
  if (['zip', 'tar', 'tgz', 'gz', 'bz2', 'xz', '7z'].includes(ext)) {
    return '📦';
  }
  
  // Documents
  if (ext === 'pdf') {
    return '📕';
  }
  
  // Text/Code
  if (['html', 'htm', 'css', 'js', 'mjs', 'jsx', 'ts', 'tsx', 'txt', 'md', 'mdx', 'json', 'xml', 'csv', 'tsv', 'yaml', 'yml', 'ini', 'conf', 'env', 'rss', 'atom', 'rdf'].includes(ext)) {
    return '📄';
  }
  
  return '👁️';
}

function buildTree(files) {
  const tree = {};
  
  // Filter out directory entries, we'll infer them from file paths
  const fileEntries = files.filter(f => !f.IsDirectory);
  
  fileEntries.forEach(file => {
    const parts = file.ObjectName.split('/').filter(p => p);
    let current = tree;
    
    parts.forEach((part, idx) => {
      if (idx === parts.length - 1) {
        // This is the file itself
        current[part] = {
          type: 'file',
          size: file.Length,
          path: file.ObjectName,
          lastChanged: file.LastChanged
        };
      } else {
        // This is a directory in the path
        if (!current[part]) {
          current[part] = { type: 'dir', children: {} };
        }
        current = current[part].children;
      }
    });
  });
  
  return tree;
}

function renderNode(name, node, prefix, isLast, token) {
  const lines = [];
  const connector = isLast ? '└── ' : '├── ';
  const extension = isLast ? '    ' : '│   ';
  
  if (node.type === 'file') {
    const line = document.createElement('div');
    line.style.fontFamily = 'monospace';
    line.style.lineHeight = '1.4';
    
    const prefixSpan = document.createElement('span');
    prefixSpan.textContent = prefix + connector;
    
    const link = document.createElement('a');
    link.href = `/~${username}/${node.path}`;
    link.download = name;
    link.textContent = name;
    link.style.color = '#00f';
    
    const timestamp = document.createElement('span');
    timestamp.textContent = ' [' + formatDate(node.lastChanged) + ']';
    timestamp.style.color = '#666';
    timestamp.title = 'Last modified';
    
    const size = document.createElement('span');
    size.textContent = ' ' + formatSize(node.size);
    size.style.color = '#666';
    size.title = 'File size';
    
    const viewIcon = document.createElement('a');
    viewIcon.href = `/~${username}/${node.path}`;
    viewIcon.target = '_blank';
    viewIcon.textContent = ' ' + getFileIcon(name);
    viewIcon.title = 'View on CDN';
    viewIcon.style.textDecoration = 'none';
    viewIcon.style.fontSize = '0.9em';
    
    const deleteBtn = document.createElement('span');
    deleteBtn.textContent = ' 🗑️';
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.style.fontSize = '0.9em';
    deleteBtn.title = 'Delete file';
    deleteBtn.onclick = () => deleteFile(node.path, token);

    // Add validation icon for HTML files
    let validateBtn = null;
    if (name.toLowerCase().endsWith('.html') || name.toLowerCase().endsWith('.htm')) {
      validateBtn = document.createElement('span');
      validateBtn.textContent = ' ✅';
      validateBtn.style.cursor = 'pointer';
      validateBtn.style.fontSize = '0.9em';
      validateBtn.title = 'Validate HTML';
      validateBtn.onclick = () => validateHtmlFile(node.path, token);
    }

    line.appendChild(prefixSpan);
    line.appendChild(link);
    line.appendChild(timestamp);
    line.appendChild(size);
    if (validateBtn) line.appendChild(validateBtn);
    line.appendChild(deleteBtn);
    line.appendChild(viewIcon);
    lines.push(line);
  } else {
    const line = document.createElement('div');
    line.style.fontFamily = 'monospace';
    line.style.lineHeight = '1.4';
    
    const prefixSpan = document.createElement('span');
    prefixSpan.textContent = prefix + connector + '📂 ' + name + '/';
    
    const deleteBtn = document.createElement('span');
    deleteBtn.textContent = ' 🗑️';
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.style.fontSize = '0.9em';
    deleteBtn.onclick = () => deleteDirectory(name, node, token);
    
    line.appendChild(prefixSpan);
    line.appendChild(deleteBtn);
    line.style.color = '#000';
    lines.push(line);
    
    const children = Object.entries(node.children).sort((a, b) => {
      if (a[1].type === 'dir' && b[1].type !== 'dir') return -1;
      if (a[1].type !== 'dir' && b[1].type === 'dir') return 1;
      return a[0].localeCompare(b[0]);
    });
    children.forEach(([childName, childNode], idx) => {
      const childIsLast = idx === children.length - 1;
      const childLines = renderNode(childName, childNode, prefix + extension, childIsLast, token);
      lines.push(...childLines);
    });
  }
  
  return lines;
}

function renderTree(files, token) {
  const treeEl = document.getElementById('tree');
  treeEl.innerHTML = '';
  
  if (files.length === 0) {
    treeEl.textContent = 'No files uploaded yet. Go to the upload page to add files!';
    return;
  }
  
  const tree = buildTree(files);
  const pre = document.createElement('pre');
  
  const header = document.createElement('div');
  header.style.fontFamily = 'monospace';
  
  const headerText = document.createElement('span');
  headerText.textContent = `~${username}/`;
  
  const deleteAllBtn = document.createElement('span');
  deleteAllBtn.textContent = ' 🗑️';
  deleteAllBtn.style.cursor = 'pointer';
  deleteAllBtn.title = 'Delete everything (cannot be undone!)';
  deleteAllBtn.onclick = () => deleteEverything(files, token);
  
  const downloadBtn = document.createElement('span');
  downloadBtn.textContent = ' 📥';
  downloadBtn.style.cursor = 'pointer';
  downloadBtn.title = 'Download all files as zip';
  downloadBtn.onclick = () => downloadAllAsZip(files, token);
  
  header.appendChild(headerText);
  header.appendChild(deleteAllBtn);
  header.appendChild(downloadBtn);
  pre.appendChild(header);
  
  const entries = Object.entries(tree).sort((a, b) => {
    if (a[1].type === 'dir' && b[1].type !== 'dir') return -1;
    if (a[1].type !== 'dir' && b[1].type === 'dir') return 1;
    return a[0].localeCompare(b[0]);
  });
  entries.forEach(([name, node], idx) => {
    const isLast = idx === entries.length - 1;
    const lines = renderNode(name, node, '', isLast, token);
    lines.forEach(line => pre.appendChild(line));
  });
  
  treeEl.appendChild(pre);
}

async function downloadAllAsZip(files, token) {
  // Create and show progress indicator
  const progressDiv = document.createElement('div');
  progressDiv.id = 'progress-indicator';
  progressDiv.style.position = 'fixed';
  progressDiv.style.top = '50%';
  progressDiv.style.left = '50%';
  progressDiv.style.transform = 'translate(-50%, -50%)';
  progressDiv.style.background = '#c0c0c0';
  progressDiv.style.border = '4px outset #fff';
  progressDiv.style.padding = '20px';
  progressDiv.style.zIndex = '10000';
  progressDiv.textContent = 'Creating zip...';
  document.body.appendChild(progressDiv);

  try {
    const link = document.createElement('a');
    link.href = '/api/files/zip';
    link.download = `${username}.zip`;

    const res = await fetch('/api/files/zip', {
      credentials: 'include'
    });

    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    } else {
      alert('Failed to download zip');
    }
  } finally {
    // Hide and remove progress indicator
    if (document.getElementById('progress-indicator')) {
      document.body.removeChild(progressDiv);
    }
  }
}

async function deleteEverything(files, token) {
  const userInput = prompt('Type "EVERYTHING" in all caps to confirm deletion of ALL files.\n\nWARNING: This cannot be undone!');
  if (userInput !== 'EVERYTHING') {
    if (userInput !== null) alert('Confirmation text does not match. Deletion cancelled.');
    return;
  }
  
  // Collect all file paths
  const filesToDelete = files.map(f => f.ObjectName);
  
  // Create progress indicator
  const progressDiv = document.createElement('div');
  progressDiv.style.position = 'fixed';
  progressDiv.style.top = '50%';
  progressDiv.style.left = '50%';
  progressDiv.style.transform = 'translate(-50%, -50%)';
  progressDiv.style.background = '#c0c0c0';
  progressDiv.style.border = '4px outset #fff';
  progressDiv.style.padding = '20px';
  progressDiv.style.zIndex = '10000';
  progressDiv.style.minWidth = '300px';
  progressDiv.textContent = `Deleting 0 of ${filesToDelete.length} files...`;
  document.body.appendChild(progressDiv);
  
  // Delete all files
  for (let i = 0; i < filesToDelete.length; i++) {
    const path = filesToDelete[i];
    progressDiv.textContent = `Deleting ${i + 1} of ${filesToDelete.length} files...`;
    
    const res = await fetch('/api/files', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ path })
    });
    
    if (!res.ok) {
      document.body.removeChild(progressDiv);
      alert(`Failed to delete ${path}`);
      return;
    }
  }
  
  document.body.removeChild(progressDiv);
  loadFiles(token);
}

async function deleteDirectory(name, node, token) {
  const userInput = prompt(`Type the directory name "${name}" to confirm deletion:`);
  if (userInput !== name) {
    if (userInput !== null) alert('Directory name does not match. Deletion cancelled.');
    return;
  }
  
  // Collect all file paths in this directory
  const filesToDelete = [];
  function collectFiles(n) {
    if (n.type === 'file') {
      filesToDelete.push(n.path);
    } else {
      Object.values(n.children).forEach(collectFiles);
    }
  }
  collectFiles(node);
  
  // Create progress indicator
  const progressDiv = document.createElement('div');
  progressDiv.style.position = 'fixed';
  progressDiv.style.top = '50%';
  progressDiv.style.left = '50%';
  progressDiv.style.transform = 'translate(-50%, -50%)';
  progressDiv.style.background = '#c0c0c0';
  progressDiv.style.border = '4px outset #fff';
  progressDiv.style.padding = '20px';
  progressDiv.style.zIndex = '10000';
  progressDiv.style.minWidth = '300px';
  progressDiv.textContent = `Deleting 0 of ${filesToDelete.length} files...`;
  document.body.appendChild(progressDiv);
  
  // Delete all files
  for (let i = 0; i < filesToDelete.length; i++) {
    const path = filesToDelete[i];
    progressDiv.textContent = `Deleting ${i + 1} of ${filesToDelete.length} files...`;
    
    const res = await fetch('/api/files', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ path })
    });
    
    if (!res.ok) {
      document.body.removeChild(progressDiv);
      alert(`Failed to delete ${path}`);
      return;
    }
  }
  
  document.body.removeChild(progressDiv);
  loadFiles(token);
}

async function deleteFile(path, token) {
  if (!confirm(`Delete ${path}?`)) return;
  
  const res = await fetch('/api/files', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    },
    credentials: 'include',
    body: JSON.stringify({ path })
  });
  
  if (res.ok) {
    loadFiles(token);
  } else {
    alert('Delete failed');
  }
}

async function validateHtmlFile(path, token) {
  // Navigate to the validation page, passing the file path as a fragment identifier
  window.open(`/validate#${encodeURIComponent(path)}`, '_blank');
}