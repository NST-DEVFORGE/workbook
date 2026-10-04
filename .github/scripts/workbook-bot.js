/**
 * Comments on a signature PR and merges it when the check passed.
 * Run by .github/workflows/validate-signature.yml from the base branch's copy.
 * Reads the PR only through the API; it never runs anything from it.
 */
module.exports = async ({ github, context, core }) => {
    const MARKER = "<!-- workbook-bot -->";
    const pr = context.payload.pull_request;
    const { owner, repo } = context.repo;
    const user = pr.user.login;
    const path = `signatures/${user}.md`;
    const passed = process.env.RESULT === "success";

    async function upsert(body) {
      const comments = await github.paginate(github.rest.issues.listComments, {
        owner, repo, issue_number: pr.number, per_page: 100,
      });
      const mine = comments.find((c) => c.user.type === "Bot" && c.body.includes(MARKER));
      const text = `${MARKER}\n${body}`;
      if (mine) await github.rest.issues.updateComment({ owner, repo, comment_id: mine.id, body: text });
      else await github.rest.issues.createComment({ owner, repo, issue_number: pr.number, body: text });
    }

    if (!passed) {
      const problems = (process.env.PROBLEMS || "").split("\n").map((s) => s.trim()).filter(Boolean);
      const list = problems.length
        ? problems.map((p) => `- [ ] ${p}`).join("\n")
        : "- [ ] The check failed before it could read your file. Open the **validate** check's log for details.";
      await upsert(
        `Hi @${user} 👋 thanks for signing the workbook! The check found ${problems.length > 1 ? "these problems" : "a problem"}:\n\n${list}\n\n` +
          "**How to fix it** (in your clone, on the same branch as this PR):\n\n" +
          "```bash\n# fix the file as described above, then:\ngit add -A\ngit commit -m \"Fix signature\"\ngit push\n```\n\n" +
          `Your file should look like:\n\n\`\`\`markdown\n# Your Real Name\n\n- **GitHub:** @${user}\n- **Batch:** 2026\n- **I'm here to:** your own line\n- **One thing I've built:** a link, or nothing yet\n\`\`\`\n\n` +
          "Push to **this same PR**. Don't open a new one. This comment updates itself each time the check re-runs.",
      );
      return;
    }

    // Passed: read the signature (as data) for a few friendly polish tips.
    const { data: file } = await github.rest.repos.getContent({ owner, repo, path, ref: pr.head.sha });
    const text = Buffer.from(file.content, "base64").toString("utf8");
    const field = (name) => (text.match(new RegExp(`^- \\*\\*${name}:\\*\\*\\s*(.*)$`, "m")) || [])[1]?.trim() ?? "";
    const goal = field("I'm here to");
    const built = field("One thing I've built");
    const name = (text.split("\n")[0] || "").replace(/^#\s*/, "").trim();
    const tips = [];
    if (/^["“].*["”]$/.test(built)) tips.push("You don't need quotes around *nothing yet*. Just write it as plain text.");
    if (/^to\b/i.test(goal)) tips.push("Your *I'm here to* line starts with \"to\", so it reads \"I'm here to: to…\". Drop the extra \"to\".");
    if (goal && goal.split(/\s+/).length < 4) tips.push("Your goal is quite short. Next time, say *what* you want to learn or build; it helps us match you with the right issues.");
    if (/\bi\b/.test(goal)) tips.push("Capitalise \"I\" in your goal line.");
    if (name && name === name.toLowerCase()) tips.push("Capitalise your name in the heading.");
    if (/(^|\s)(?!https?:\/\/)[\w-]+\.(netlify\.app|vercel\.app|onrender\.com|github\.io|com|dev|app)\b/i.test(built)) tips.push("Start links with `https://` so they're clickable.");
    if (/^(learning|to learn|learn)/i.test(built)) tips.push("*One thing I've built* is for something you've made (or *nothing yet*), not a goal.");
    if (text.split("\n").some((line) => /\S {2,}/.test(line))) tips.push("There are some double spaces. Reading your own diff before opening a PR catches these.");

    const feedback = tips.length
      ? "**A few polish tips for next time** (no need to change this PR):\n" + tips.map((t) => `- ${t}`).join("\n")
      : "Clean signature, nothing to polish. 👌";

    let merged = false;
    let staleFork = false;
    try {
      await github.rest.pulls.merge({
        owner, repo, pull_number: pr.number,
        sha: pr.head.sha, // only the exact commit that passed the check
        // Squash keeps one commit per signature on main.
        merge_method: "squash",
        commit_title: `Sign the workbook: ${name || user} (#${pr.number})`,
      });
      merged = true;
    } catch (e) {
      core.warning(`Merge failed: ${e.message}`);
      // GitHub counts a branch carrying an older copy of a workflow file as a PR
      // that "modifies workflows", and this token may not merge those. Syncing the
      // fork clears it, and is a useful thing for a contributor to learn anyway.
      staleFork = e.status === 403;
    }

    const stuck = staleFork
      ? `⚠️ @${user}, your signature is **correct**, but I can't merge it: your fork was made before we updated this repo's GitHub Actions workflow, and GitHub won't let me merge a branch that carries an older copy of it.\n\n` +
        "**Fix it in 30 seconds:**\n" +
        "1. Open **your fork** of this repo on GitHub.\n" +
        "2. Click **Sync fork** → **Update branch**.\n" +
        "3. Back here, click **Update branch** if the button is offered, or run:\n\n" +
        "```bash\ngit remote add upstream https://github.com/NST-DEVFORGE/workbook.git 2>/dev/null; git fetch upstream\ngit merge upstream/main\ngit push\n```\n\n" +
        "I'll re-check and merge automatically. A council member can also merge it for you."
      : `✅ @${user}, your signature passed the check. The automatic merge didn't go through, so a council member will merge it shortly.`;

    await upsert(
      merged
        ? `🎉 Welcome to DevForge, @${user}! The check passed and your signature is **merged**.\n\n${feedback}\n\n` +
            "**Next:** open [the workbook](https://www.devforge.club/workbook), submit **milestone 1** with this PR's link, and write your reflection within 48 hours. Then on to milestone 2!"
        : `${stuck}\n\n${feedback}`,
    );
};
