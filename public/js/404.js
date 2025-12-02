import { register } from "/assets/@teamhanko/hanko-elements/dist/elements.js";

const { hanko } = await register(window.HANKO_API_URL);

const token = await hanko.getSessionToken();
if (token) {
  window.hankoToken = token;
  const user = await hanko.getUser();
  const username = user.username;

  // Get current path
  const path = window.location.pathname;
  const filename = path.split('/').pop();

  if (filename) {
    try {
      const res = await fetch('/api/files', {
        credentials: 'include'
      });

      if (res.ok) {
        const files = await res.json();
        const matches = files.filter(f => f.ObjectName.includes(filename));

        if (matches.length > 0) {
          const suggestionsDiv = document.getElementById('suggestions');
          suggestionsDiv.style.display = 'block';

          const list = document.getElementById('matchList');
          matches.forEach(match => {
            const li = document.createElement('li');
            li.innerHTML = `<code>${match.ObjectName}</code> → <a href="/~${username}/${match.ObjectName}">/~${username}/${match.ObjectName}</a>`;
            list.appendChild(li);
          });
        }
      }
    } catch (e) {
      console.error('Failed to check files', e);
    }
  }
}