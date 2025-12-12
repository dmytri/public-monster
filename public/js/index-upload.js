const form = document.getElementById('uploadForm');
const status = document.getElementById('status');
const filesInput = document.getElementById('files');
const folderInput = document.getElementById('folder');

// Show/hide clear buttons and handle clearing
const clearFilesBtn = document.getElementById('clearFiles');
const clearFolderBtn = document.getElementById('clearFolder');

filesInput.addEventListener('change', () => {
  clearFilesBtn.style.display = filesInput.files.length > 0 ? 'inline' : 'none';
});

folderInput.addEventListener('change', () => {
  clearFolderBtn.style.display = folderInput.files.length > 0 ? 'inline' : 'none';
});

clearFilesBtn.addEventListener('click', () => {
  filesInput.value = '';
  clearFilesBtn.style.display = 'none';
});

clearFolderBtn.addEventListener('click', () => {
  folderInput.value = '';
  clearFolderBtn.style.display = 'none';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const files = [...(filesInput.files || []), ...(folderInput.files || [])];

  if (files.length === 0) {
    status.textContent = '❌ No files selected';
    return;
  }

  // Disable the upload button during upload
  const uploadButton = document.getElementById('btn');
  uploadButton.disabled = true;
  uploadButton.textContent = '⏳ Uploading...';

  status.textContent = `⏳ Uploading ${files.length} file(s)...`;

  const flattenFolder = document.getElementById('flattenFolder').checked;

  let count = 0;
  for (const file of files) {
    count++;
    status.textContent = `⏳ Uploading ${count}/${files.length}: ${file.name}...`;
    const formData = new FormData();
    formData.append('file', file);

    let path = file.webkitRelativePath || file.name;

    // If flatten is checked and this is a folder upload, strip the first folder name
    if (flattenFolder && file.webkitRelativePath) {
      const parts = file.webkitRelativePath.split('/');
      if (parts.length > 1) {
        path = parts.slice(1).join('/');
      }
    }

    formData.append('path', path);

    try {
      const headers = {};
      if (window.hankoToken) {
        headers['Authorization'] = 'Bearer ' + window.hankoToken;
      }

      const res = await fetch('/api/files', {
        method: 'POST',
        headers: headers,
        body: formData
      });

      if (!res.ok) {
        // Handle content blocked by safety scanner (HTTP 451)
        if (res.status === 451) {
          const message = await res.text();
          status.textContent = `🚫 Upload blocked (${count}/${files.length}): ${file.name} - ${message}`;
        } else {
          status.textContent = `❌ Upload failed (${count}/${files.length}): ${file.name}`;
        }
        // Re-enable the upload button on failure
        uploadButton.disabled = false;
        uploadButton.textContent = '🚀 Upload';
        return;
      }

      // Small delay between uploads to avoid rate limiting
      if (count < files.length) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } catch (err) {
      status.textContent = `❌ Error: ${err.message}`;
      // Re-enable the upload button on error
      uploadButton.disabled = false;
      uploadButton.textContent = '🚀 Upload';
      return;
    }
  }

  status.textContent = `✅ Uploaded ${files.length} file(s)!`;
  filesInput.value = '';
  folderInput.value = '';
  clearFilesBtn.style.display = 'none';
  clearFolderBtn.style.display = 'none';

  // Re-enable the upload button after completion
  uploadButton.disabled = false;
  uploadButton.textContent = '🚀 Upload';
});

// Create starter page handler
document.getElementById('createStarter')?.addEventListener('click', async () => {
  const btn = document.getElementById('createStarter');
  const status = document.getElementById('starterStatus');

  btn.disabled = true;
  status.textContent = ' ⏳ Creating...';

  try {
    const res = await fetch('/api/create-starter', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + window.hankoToken }
    });

    if (res.ok) {
      status.textContent = ' ✅ Created!';
      document.getElementById('starterSection').style.display = 'none';
      document.getElementById('validateSection').style.display = 'block';
      setTimeout(() => {
        window.location.href = document.getElementById('link').href;
      }, 1000);
    } else {
      status.textContent = ' ❌ Failed';
      btn.disabled = false;
    }
  } catch (err) {
    status.textContent = ' ❌ Error';
    btn.disabled = false;
  }
});

// Validate HTML button handler
document.getElementById('validateHtml')?.addEventListener('click', async () => {
  // Navigate to the HTML validation page
  window.location.href = '/validate';
});

window.hankoToken = null;