import { register } from "/assets/@teamhanko/hanko-elements/dist/elements.js";

// Calculate the Levenshtein distance between two strings
function dist(s1, s2) {
  // Create a matrix of size (s1.length+1) x (s2.length+1)
  const dp = Array(s1.length + 1).fill().map(() => Array(s2.length + 1).fill(0));

  // Initialize the first row and column
  for (let i = 0; i <= s1.length; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= s2.length; j++) {
    dp[0][j] = j;
  }

  // Fill the matrix
  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],     // deletion
          dp[i][j - 1],     // insertion
          dp[i - 1][j - 1]  // substitution
        );
      }
    }
  }

  return dp[s1.length][s2.length];
}

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
        const matches = files.filter(f => dist(f.ObjectName.toLowerCase(), filename.toLowerCase()) <= 2);

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