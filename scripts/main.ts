import { Octokit } from "https://esm.sh/octokit@4.1.0?dts";
import { RestEndpointMethodTypes } from "https://esm.sh/@octokit/plugin-rest-endpoint-methods@13.3.0?dts";
import { format } from "jsr:@std/datetime";
import { stringify as yamlStringify } from "jsr:@std/yaml";
import { join as pathJoin } from "jsr:@std/path";
import { sanitize } from "https://deno.land/x/sanitize_filename@1.2.1/sanitize.ts";
import { parse as tomlParse } from "jsr:@std/toml";

const OUTPUT_DIR = "content/posts";
const CONFIG_FILE = "scripts/config.toml";

// Types
type IssuesListCommentsParameters =
  RestEndpointMethodTypes["issues"]["listComments"]["parameters"];
type IssuesListCommentsResponse =
  RestEndpointMethodTypes["issues"]["listComments"]["response"];
type IssuesListCommentsResponseDataType = IssuesListCommentsResponse["data"];

type IssuesListForRepoParameters =
  RestEndpointMethodTypes["issues"]["listForRepo"]["parameters"];
type IssuesListForRepoResponse =
  RestEndpointMethodTypes["issues"]["listForRepo"]["response"];
type IssuesListForRepoResponseDataType = IssuesListForRepoResponse["data"];

//  Enhanced to create nested directories 
async function writeFile(path: string, text: string): Promise<void> {
  const dir = pathJoin(...path.split("/").slice(0, -1));
  await Deno.mkdir(dir, { recursive: true }); // Creates all necessary parent dirs
  return await Deno.writeTextFile(path, text);
}


// Format date
const formatDate = (d: string) => format(new Date(d), "yyyy-MM-dd");

// Read config file in toml format, return {} if error occurs
async function readConfigFile(path: string): Promise<Record<string, unknown>> {
  try {
    const text = await Deno.readTextFile(path);
    const config = tomlParse(text);
    return Promise.resolve(config);
  } catch (error) {
    console.error(error);
    return Promise.resolve({});
  }
}

// Helper to get valid subdirectory name from labels 
function getSubdirectoryName(labels: string[], excludedLabels: string[]): string {
  const validLabels = labels.filter(l => !excludedLabels.includes(l));
  if (validLabels.length === 0) return "general"; // Default folder
  
  // Clean label for filesystem use
  return validLabels[0]
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}


// Get GitHub token from environment variable
const GITHUB_TOKEN: string = Deno.env.get("GITHUB_TOKEN")!;
const GITHUB_REPOSITORY: string = Deno.env.get("GITHUB_REPOSITORY")!;

const [owner, repo] = GITHUB_REPOSITORY.split("/");

// Read config toml file
const config = await readConfigFile(CONFIG_FILE);

const octokit = new Octokit({
  auth: GITHUB_TOKEN,
  baseUrl: String(config.baseUrl),
});

// Main processing loop now uses label-based subdirs 
for await (const { data: issues } of octokit.paginate.iterator(
  octokit.rest.issues.listForRepo,
  { owner, repo, per_page: 100, state: config.state || "all" }
)) {
  for (const issue of issues as IssuesListForRepoResponseDataType) {
    if (issue.pull_request) continue;

    console.log("Processing Issue #%d: %s", issue.number, issue.title);

    // Calculate output subdirectory 
    const labels = issue.labels.map(l => typeof l === "object" ? l.name! : l);
    const subDir = getSubdirectoryName(
      labels,
      config.excludedLabels as string[] || []
    );

    // (Keep existing frontmatter generation)
    const frontmatter = {
      title: issue.title,
      date: formatDate(issue.created_at),
      lastMod: formatDate(issue.updated_at),
      tags: labels,
      ...(config.enableEditUrl ? { editURL: issue.html_url } : {})
    };

    // Path now includes subdirectory 
    const filename = `${sanitize(issue.title)}.md`;
    const outpath = pathJoin(OUTPUT_DIR, subDir, filename);

    // content assembly
    const content = [
      `---\n${yamlStringify(frontmatter)}\n---`,
      issue.body!.trim(),
      (await octokit.rest.issues.listComments({ 
        owner, repo, issue_number: issue.number 
      })).data.map(c => c.body!).join("\n\n")
    ].join("\n\n").trim();

    await writeFile(outpath, content);
    console.log(`Saved to: ${outpath}`);
  }
}

Deno.exit();

Deno.exit();
