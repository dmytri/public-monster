// Hanko authentication initialization
import { register } from "/assets/@teamhanko/hanko-elements/dist/elements.js";

let currentUserId = null;
let hankoToken = null;

const { hanko } = await register(window.HANKO_API_URL);

document.getElementById("logout-link")
  .addEventListener("click", (event) => {
      event.preventDefault();
      hanko.user.logout();
  });

hanko.onUserLoggedOut(() => {
  // successfully logged out, redirect to a page in your application
  document.location.href = "/"
})

const showAuth = () => {
  document.getElementById('auth').style.display = 'block';
  document.getElementById('upload').style.display = 'none';
};

const showUpload = async (userId) => {
  currentUserId = userId;
  document.getElementById('auth').style.display = 'none';
  document.getElementById('upload').style.display = 'block';
  document.getElementById('link').href = '/~' + userId + '/';
  document.getElementById('link').textContent = '/~' + userId + '/';

  // Check if index.html exists
  try {
    const res = await fetch('/api/files', {
      headers: { 'Authorization': 'Bearer ' + window.hankoToken }
    });
    if (res.ok) {
      const files = await res.json();
      const hasIndex = files.some(f => f.ObjectName === 'index.html');
      document.getElementById('starterSection').style.display = hasIndex ? 'none' : 'block';
      document.getElementById('validateSection').style.display = hasIndex ? 'block' : 'none';
    }
  } catch (e) {
    console.error('Failed to check for index.html', e);
  }
};

hanko.onSessionCreated(async (event) => {
  window.hankoToken = await hanko.getSessionToken();
  const user = await hanko.getUser();
  const userId = user.username;
  showUpload(userId);
});

const token = await hanko.getSessionToken();
if (token) {
  window.hankoToken = token;
  const user = await hanko.getUser();
  const userId = user.username;
  console.log(user);
  showUpload(userId);
}