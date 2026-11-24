const GITHUB_OWNER = process.env.GITHUB_OWNER; // e.g. "adityachoudhary53583-cpu"
const GITHUB_REPO = process.env.GITHUB_REPO;   // e.g. "apk-builder-bot"
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // Fine-grained or classic PAT with Actions write access
const WORKFLOW_FILE = process.env.WORKFLOW_FILE || "build-apk.yml";

async function triggerGitHubBuild({ apkUrl, websiteUrl, websiteZipUrl, tagName }) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: "main",
      inputs: {
        apk_url: apkUrl || "",
        website_url: websiteUrl || "",
        website_zip_url: websiteZipUrl || "",
        tag_name: tagName,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub dispatch failed (${res.status}): ${errText}`);
  }
}
