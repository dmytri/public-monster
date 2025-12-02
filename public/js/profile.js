import { register } from "/assets/@teamhanko/hanko-elements/dist/elements.js";

const { hanko } = await register(window.HANKO_API_URL);

const token = await hanko.getSessionToken();
if (!token) {
  window.location.href = '/';
} else {
  const user = await hanko.getUser();
  document.getElementById('username').textContent = user.username;
  window.originalUsername = user.username; // Store for migration
}

hanko.onSessionExpired(() => {
  window.location.href = '/';
});

hanko.onUserDeleted(() => {
  window.location.href = '/';
});

// Step 1: Prepare migration
window.prepareMigration = async function() {
  const confirmed = confirm('This will prepare your account for username migration. Click OK to continue.');
  if (!confirmed) return;
  
  const token = await hanko.getSessionToken();
  const res = await fetch('/api/prepare-migration', {
    method: 'POST',
    credentials: 'include'
  });
  
  if (res.ok) {
    const data = await res.json();
    window.migrationToken = data.token;
    alert('✓ Migration prepared! Now you can change your username in the profile below, then click the second button.');
    document.getElementById('migrate-btn').style.display = 'inline-block';
  } else {
    alert('Failed to prepare migration.');
  }
};

// Step 2: Execute migration
window.migrateUsername = async function() {
  if (!window.migrationToken) {
    alert('You must click "Prepare migration" first!');
    return;
  }
  
  const newUser = await hanko.getUser();
  const newUsername = newUser.username;
  const oldUsername = window.originalUsername;
  
  if (oldUsername === newUsername) {
    alert('Your username has not changed.');
    return;
  }
  
  const confirmed = confirm(`Migrate all files from ~${oldUsername}/ to ~${newUsername}/?\n\nIf this fails, you can change your username back to "${oldUsername}" to recover your files and try again.`);
  if (!confirmed) return;
  
  // Show progress indicator
  const progressDiv = document.createElement('div');
  progressDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border:3px solid #000;padding:30px;font-size:1.2em;z-index:9999';
  progressDiv.textContent = 'Migrating files, please wait...';
  document.body.appendChild(progressDiv);
  
  const token = await hanko.getSessionToken();
  const res = await fetch('/api/migrate-username', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    credentials: 'include',
    body: JSON.stringify({ 
      oldUsername,
      token: window.migrationToken 
    })
  });
  
  document.body.removeChild(progressDiv);
  
  if (res.ok) {
    alert('✓ Files migrated successfully!');
    delete window.migrationToken;
    window.location.reload();
  } else {
    const error = await res.text();
    alert('Migration failed: ' + error + '\n\nYou can change your username back to "' + oldUsername + '" to recover your files.');
  }
};