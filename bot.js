async function triggerMergeBuild({ sourceZipUrl, panelZipUrl, tagName }) {
  const githubOwner = (process.env.GITHUB_OWNER || "").trim();
  const githubRepo = (process.env.GITHUB_REPO || "").trim();
  const githubToken = (process.env.GITHUB_TOKEN || "").trim();
  const githubBranch = (process.env.GITHUB_BRANCH || "main").trim();

  if (!githubOwner || !githubRepo || !githubToken) {
    throw new Error("GITHUB_OWNER, GITHUB_REPO, ya GITHUB_TOKEN env missing hai.");
  }

  const url = `https://api.github.com/repos/${githubOwner}/${githubRepo}/actions/workflows/merge-source-panel.yml/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: githubBranch,
      inputs: {
        source_zip_url: sourceZipUrl,
        panel_zip_url: panelZipUrl,
        tag_name: tagName,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Merge workflow dispatch fail (${res.status}): ${errText}`);
  }
}

bot.command("mergebuild", async (ctx) => {
  const s = getSession(ctx.from.id);
  if (!s.sourceZipUrl) {
    return ctx.reply("Pehle extracted source code ZIP ka https:// link bhejein.");
  }
  if (!s.websiteZipUrl) {
    return ctx.reply("Pehle website panel ki .zip file ya https:// link bhejein.");
  }

  const tagName = `merged-${ctx.from.id}-${Date.now()}`;
  const statusMsg = await ctx.reply("Source + Website Panel merge aur APK build start ho raha hai...");

  try {
    await triggerMergeBuild({
      sourceZipUrl: s.sourceZipUrl,
      panelZipUrl: s.websiteZipUrl,
      tagName,
    });
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      [
        "Merge & Build workflow start ho gaya!",
        `Tag: ${tagName}`,
        "GitHub Releases mein `merged-panel-app.apk` banne ke baad download kar lein.",
      ].join("\n")
    );
  } catch (err) {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      `Error: ${err.message}`
    );
  }
});
