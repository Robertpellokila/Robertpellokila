
import fs from "node:fs/promises";

const ROOT = process.cwd();

const CONFIG_PATH = `${ROOT}/.github/featured-projects.json`;
const README_PATH = `${ROOT}/README.md`;

const START_MARKER = "<!-- FEATURED_PROJECTS_START -->";
const END_MARKER = "<!-- FEATURED_PROJECTS_END -->";

const config = JSON.parse(
  await fs.readFile(CONFIG_PATH, "utf8")
);

const {
  username,
  maxProjects = 6,
  featured = [],
  exclude = [],
  showForks = false,
  showArchived = false
} = config;

if (!username) {
  throw new Error("GitHub username is required.");
}

const excluded = new Set(
  exclude.map(name => name.toLowerCase())
);

const featuredNames = featured.map(name =>
  name.toLowerCase()
);

const token = process.env.GITHUB_TOKEN;

console.log(`Fetching repositories for ${username}...`);

const response = await fetch(
  `https://api.github.com/users/${username}/repos?type=owner&sort=updated&direction=desc&per_page=100`,
  {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token && {
        Authorization: `Bearer ${token}`
      }),
      "X-GitHub-Api-Version": "2022-11-28"
    }
  }
);

if (!response.ok) {
  throw new Error(
    `GitHub API error: ${response.status} ${response.statusText}`
  );
}

const repositories = await response.json();

const eligibleRepositories = repositories.filter(repo => {
  return (
    !repo.private &&
    !repo.fork &&
    !excluded.has(repo.name.toLowerCase()) &&
    (showForks || !repo.fork) &&
    (showArchived || !repo.archived)
  );
});

const repositoryMap = new Map(
  eligibleRepositories.map(repo => [
    repo.name.toLowerCase(),
    repo
  ])
);

// 1. Pick manually selected repositories
const selectedFeatured = featuredNames
  .map(name => {
    const repo = repositoryMap.get(name);

    if (!repo) {
      console.warn(
        `Featured repository not found: ${name}`
      );
    }

    return repo;
  })
  .filter(Boolean);

// 2. Fill remaining slots with recently updated repos
const selectedNames = new Set(
  selectedFeatured.map(repo => repo.name.toLowerCase())
);

const latestRepositories = eligibleRepositories
  .filter(repo => !selectedNames.has(repo.name.toLowerCase()))
  .sort((a, b) =>
    new Date(b.pushed_at || b.updated_at) -
    new Date(a.pushed_at || a.updated_at)
  );

const remainingSlots = Math.max(
  0,
  maxProjects - selectedFeatured.length
);

const selectedLatest = latestRepositories.slice(
  0,
  remainingSlots
);

// 3. Combine featured + latest
const projects = [
  ...selectedFeatured.map(repo => ({
    ...repo,
    projectType: "FEATURED"
  })),

  ...selectedLatest.map(repo => ({
    ...repo,
    projectType: "LATEST"
  }))
].slice(0, maxProjects);

console.log(`Selected ${projects.length} projects.`);

// 4. HTML escaping
function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function badge(label, color) {
  const url =
    `https://img.shields.io/badge/${encodeURIComponent(label)}-${color}?style=flat-square`;

  return `<img src="${url}" alt="${escapeHTML(label)}" />`;
}

// 5. Create project cards
function createCard(repo) {
  const name = escapeHTML(repo.name);
  const description = escapeHTML(
    repo.description || "No description provided yet."
  );

  const language = repo.language || "Other";

  const languageColors = {
    JavaScript: "f1e05a",
    TypeScript: "3178c6",
    Vue: "41b883",
    Python: "3572A5",
    Java: "b07219",
    PHP: "4F5D95",
    Go: "00ADD8",
    HTML: "e34c26",
    CSS: "563d7c",
    Dart: "00B4AB",
    Kotlin: "A97BFF",
    Rust: "dea584"
  };

  const languageColor =
    languageColors[language] || "64748b";

  const typeColor =
    repo.projectType === "FEATURED"
      ? "7c3aed"
      : "0891b2";

  const typeBadge = badge(
    repo.projectType,
    typeColor
  );

  const languageBadge = badge(
    language,
    languageColor
  );

  const starsBadge =
    `<img src="https://img.shields.io/github/stars/${username}/${repo.name}?style=flat-square&color=f59e0b&label=stars" alt="Stars" />`;

  const forksBadge =
    `<img src="https://img.shields.io/github/forks/${username}/${repo.name}?style=flat-square&color=64748b&label=forks" alt="Forks" />`;

  const topics = (repo.topics || [])
    .slice(0, 3)
    .map(topic =>
      `<code>${escapeHTML(topic)}</code>`
    )
    .join(" ");

  return `
    <td width="50%" valign="top">
      <h3>
        <a href="${repo.html_url}">✦ ${name}</a>
      </h3>

      <p>${description}</p>

      <p>
        ${typeBadge}
        ${languageBadge}
      </p>

      <p>
        ${starsBadge}
        ${forksBadge}
      </p>

      <p>${topics}</p>

      <p>
        <a href="${repo.html_url}">
          <strong>Explore Repository →</strong>
        </a>
      </p>
    </td>
  `;
}

// 6. Generate HTML table
const rows = [];

for (let i = 0; i < projects.length; i += 2) {
  const left = createCard(projects[i]);

  const right = projects[i + 1]
    ? createCard(projects[i + 1])
    : '<td width="50%"></td>';

  rows.push(`<tr>${left}${right}</tr>`);
}

const generatedHTML = `
<h2 align="center">🚀 Featured Projects</h2>

<p align="center">
  <i>Selected work, experiments, and latest development projects.</i>
</p>

<table width="100%" align="center">
  ${rows.join("\n")}
</table>

<p align="center">
  <a href="https://github.com/${username}?tab=repositories">
    <img src="https://img.shields.io/badge/Explore_All_Repositories-181717?style=for-the-badge&logo=github&logoColor=white" />
  </a>
</p>

<p align="center">
  <sub>Automatically updated with GitHub Actions.</sub>
</p>
`.trim();

// 7. Update README between markers
let readme = await fs.readFile(README_PATH, "utf8");

const start = readme.indexOf(START_MARKER);
const end = readme.indexOf(END_MARKER);

if (start === -1 || end === -1 || end < start) {
  throw new Error(
    "Featured Projects markers are missing or invalid in README.md"
  );
}

const before = readme.slice(
  0,
  start + START_MARKER.length
);

const after = readme.slice(end);

readme =
  `${before}\n\n${generatedHTML}\n\n${after}`;

await fs.writeFile(README_PATH, readme, "utf8");

console.log("README Featured Projects updated successfully!");

console.log(
  projects.map(repo =>
    `${repo.projectType}: ${repo.name}`
  ).join("\n")
);
