import type { Review } from "./gate";

export interface RepoInfo {
  default_branch: string;
  full_name: string;
}

export interface Pull {
  number: number;
  node_id: string;
  title: string;
  html_url: string;
  state: string;
  draft: boolean;
  merged: boolean;
  merge_commit_sha: string | null;
  mergeable_state?: string;
  updated_at: string;
  user: { login: string };
  labels: { name: string }[];
  auto_merge: unknown | null;
  head: { sha: string; ref: string; repo: { full_name: string } | null };
}

export interface Issue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  updated_at: string;
  labels: { name: string }[];
}

export interface IssueEvent {
  event: string;
  created_at: string;
  label?: { name: string };
}

export interface Comment {
  id: number;
  body: string;
  created_at: string;
  user: { login: string } | null;
}

export interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  head_sha: string;
  html_url: string;
  created_at: string;
}

export interface ArtifactInfo {
  runId: number;
  headSha: string;
  expired: boolean;
}

export interface GitHubClient {
  getRepo(): Promise<RepoInfo>;
  getPull(n: number): Promise<Pull>;
  listPullFiles(n: number): Promise<string[]>;
  listReviews(n: number): Promise<Review[]>;
  listIssueEvents(n: number): Promise<IssueEvent[]>;
  listComments(n: number): Promise<Comment[]>;
  getRepoFile(path: string, ref: string): Promise<string>;
  addLabels(n: number, labels: string[]): Promise<void>;
  removeLabel(n: number, label: string): Promise<void>;
  createComment(n: number, body: string): Promise<void>;
  createIssue(input: {
    title: string;
    body: string;
    labels: string[];
  }): Promise<number>;
  setStatus(
    sha: string,
    context: string,
    state: "success" | "pending" | "failure" | "error",
    description: string,
    targetUrl?: string,
  ): Promise<void>;
  dispatchWorkflow(
    workflow: string,
    ref: string,
    inputs: Record<string, string>,
  ): Promise<void>;
  listWorkflowRuns(
    workflow: string,
    query: Record<string, string>,
  ): Promise<WorkflowRun[]>;
  getWorkflowRun(id: number): Promise<WorkflowRun>;
  listTeamMembers(org: string, team: string): Promise<string[]>;
  listOpenIssuesByLabel(label: string): Promise<Issue[]>;
  listOpenPulls(): Promise<Pull[]>;
  listArtifacts(name: string): Promise<ArtifactInfo[]>;
  downloadArtifactJson(runId: number, name: string): Promise<unknown>;
  enableAutoMerge(pullNodeId: string): Promise<void>;
  markReadyForReview(pullNodeId: string): Promise<void>;
}

const nextLink = (header: string | null): string | undefined =>
  header?.match(/<([^>]+)>;\s*rel="next"/)?.[1];

// zip の先頭のファイルを読む (artifact は 1 ファイルだけの zip)
export async function readFirstZipEntry(zip: Uint8Array): Promise<string> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = zip.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("zip を読めません");
  const central = view.getUint32(eocd + 16, true);
  if (view.getUint32(central, true) !== 0x02014b50)
    throw new Error("zip を読めません");
  const method = view.getUint16(central + 10, true);
  const size = view.getUint32(central + 20, true);
  const local = view.getUint32(central + 42, true);
  const start =
    local +
    30 +
    view.getUint16(local + 26, true) +
    view.getUint16(local + 28, true);
  const data = zip.slice(start, start + size);
  if (method === 0) return new TextDecoder().decode(data);
  if (method !== 8) throw new Error("zip の圧縮方式に対応していません");
  const stream = new Blob([data])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}

export function createGitHubClient(opts: {
  token: string;
  repo: string;
  fetchImpl?: typeof fetch;
  apiUrl?: string;
}): GitHubClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const apiUrl = opts.apiUrl ?? "https://api.github.com";
  const repoPath = `/repos/${opts.repo}`;

  const headers = (accept = "application/vnd.github+json") => ({
    Authorization: `Bearer ${opts.token}`,
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
  });

  // エラーには、メソッドとパスと状態だけを入れる (トークンを含めない)
  async function call(
    method: string,
    path: string,
    body?: unknown,
    accept?: string,
  ): Promise<Response> {
    const url = path.startsWith("http") ? path : `${apiUrl}${path}`;
    const res = await fetchImpl(url, {
      method,
      headers: {
        ...headers(accept),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      throw new Error(
        `GitHub の呼び出しに失敗しました: ${method} ${path.split("?")[0]} HTTP ${res.status}`,
      );
    }
    return res;
  }

  const json = async <T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> => (await call(method, path, body)).json() as Promise<T>;

  async function paginate<T>(
    path: string,
    pick: (page: unknown) => T[] = (p) => p as T[],
  ): Promise<T[]> {
    const items: T[] = [];
    let url: string | undefined =
      `${path}${path.includes("?") ? "&" : "?"}per_page=100`;
    while (url) {
      const res = await call("GET", url);
      items.push(...pick(await res.json()));
      url = nextLink(res.headers.get("link"));
    }
    return items;
  }

  async function graphql(query: string, variables: object): Promise<void> {
    const res = await json<{ errors?: { message: string }[] }>(
      "POST",
      "/graphql",
      { query, variables },
    );
    if (res.errors?.length) {
      throw new Error(
        `GitHub の GraphQL が失敗しました: ${res.errors.map((e) => e.message).join("; ")}`,
      );
    }
  }

  return {
    getRepo: () => json("GET", repoPath),
    getPull: (n) => json("GET", `${repoPath}/pulls/${n}`),
    listPullFiles: async (n) =>
      (
        await paginate<{ filename: string }>(`${repoPath}/pulls/${n}/files`)
      ).map((f) => f.filename),
    listReviews: async (n) =>
      (
        await paginate<{
          user: { login: string } | null;
          state: string;
          commit_id: string;
          submitted_at: string | null;
        }>(`${repoPath}/pulls/${n}/reviews`)
      ).map((r) => ({
        user: r.user?.login ?? "",
        state: r.state.toUpperCase() as Review["state"],
        commitId: r.commit_id,
        submittedAt: r.submitted_at ?? "",
      })),
    listIssueEvents: (n) => paginate(`${repoPath}/issues/${n}/events`),
    listComments: (n) => paginate(`${repoPath}/issues/${n}/comments`),
    getRepoFile: async (path, ref) =>
      (
        await call(
          "GET",
          `${repoPath}/contents/${path}?ref=${encodeURIComponent(ref)}`,
          undefined,
          "application/vnd.github.raw+json",
        )
      ).text(),
    addLabels: async (n, labels) => {
      await call("POST", `${repoPath}/issues/${n}/labels`, { labels });
    },
    removeLabel: async (n, label) => {
      try {
        await call(
          "DELETE",
          `${repoPath}/issues/${n}/labels/${encodeURIComponent(label)}`,
        );
      } catch (e) {
        if (!(e as Error).message.endsWith("HTTP 404")) throw e;
      }
    },
    createComment: async (n, body) => {
      await call("POST", `${repoPath}/issues/${n}/comments`, { body });
    },
    createIssue: async (input) =>
      (await json<{ number: number }>("POST", `${repoPath}/issues`, input))
        .number,
    setStatus: async (sha, context, state, description, targetUrl) => {
      await call("POST", `${repoPath}/statuses/${sha}`, {
        state,
        context,
        description,
        ...(targetUrl ? { target_url: targetUrl } : {}),
      });
    },
    dispatchWorkflow: async (workflow, ref, inputs) => {
      await call(
        "POST",
        `${repoPath}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
        { ref, inputs },
      );
    },
    listWorkflowRuns: async (workflow, query) =>
      (
        await json<{ workflow_runs: WorkflowRun[] }>(
          "GET",
          `${repoPath}/actions/workflows/${encodeURIComponent(workflow)}/runs?${new URLSearchParams(query)}`,
        )
      ).workflow_runs,
    getWorkflowRun: (id) => json("GET", `${repoPath}/actions/runs/${id}`),
    listTeamMembers: async (org, team) =>
      (
        await paginate<{ login: string }>(`/orgs/${org}/teams/${team}/members`)
      ).map((m) => m.login),
    listOpenIssuesByLabel: async (label) =>
      (
        await paginate<Issue & { pull_request?: unknown }>(
          `${repoPath}/issues?state=open&labels=${encodeURIComponent(label)}`,
        )
      ).filter((i) => i.pull_request === undefined),
    listOpenPulls: () => paginate(`${repoPath}/pulls?state=open`),
    listArtifacts: async (name) =>
      (
        await paginate<{
          expired: boolean;
          workflow_run: { id: number; head_sha: string } | null;
        }>(
          `${repoPath}/actions/artifacts?name=${encodeURIComponent(name)}`,
          (p) => (p as { artifacts: never[] }).artifacts,
        )
      )
        .filter((a) => a.workflow_run !== null)
        .map((a) => ({
          runId: a.workflow_run?.id ?? 0,
          headSha: a.workflow_run?.head_sha ?? "",
          expired: a.expired,
        })),
    downloadArtifactJson: async (runId, name) => {
      const list = await paginate<{ id: number; name: string }>(
        `${repoPath}/actions/runs/${runId}/artifacts`,
        (p) => (p as { artifacts: never[] }).artifacts,
      );
      const found = list.find((a) => a.name === name);
      if (!found) throw new Error(`artifact ${name} が見つかりません`);
      const res = await call(
        "GET",
        `${repoPath}/actions/artifacts/${found.id}/zip`,
      );
      return JSON.parse(
        await readFirstZipEntry(new Uint8Array(await res.arrayBuffer())),
      );
    },
    enableAutoMerge: (pullNodeId) =>
      graphql(
        "mutation($id: ID!) { enablePullRequestAutoMerge(input: {pullRequestId: $id, mergeMethod: SQUASH}) { clientMutationId } }",
        { id: pullNodeId },
      ),
    markReadyForReview: (pullNodeId) =>
      graphql(
        "mutation($id: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $id}) { clientMutationId } }",
        { id: pullNodeId },
      ),
  };
}
