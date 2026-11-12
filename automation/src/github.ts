export interface RepoInfo {
  default_branch: string;
  full_name: string;
}

export interface Pull {
  number: number;
  node_id: string;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  draft: boolean;
  merged: boolean;
  merge_commit_sha: string | null;
  mergeable_state?: string;
  created_at: string;
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
  created_at: string;
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
  head_branch: string | null;
  /** 実行を起こした人 (workflow_dispatch なら、起動した人) */
  triggering_actor?: { login: string } | null;
  html_url: string;
  created_at: string;
}

export interface GitHubClient {
  getRepo(): Promise<RepoInfo>;
  getPull(n: number): Promise<Pull>;
  /** admin / write / read / none (maintain は write に入る) */
  /** SHA の最新の check run の名前と結論 */
  listCheckRuns(
    sha: string,
  ): Promise<{ name: string; conclusion: string | null }[]>;
  getPermission(login: string): Promise<string>;
  listPullFiles(n: number): Promise<string[]>;
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
  listOpenIssuesByLabel(label: string): Promise<Issue[]>;
  listOpenIssues(): Promise<Issue[]>;
  listOpenPulls(): Promise<Pull[]>;
  getCommitParents(sha: string): Promise<string[]>;
  mergePull(n: number, sha: string): Promise<void>;
  enableAutoMerge(pullNodeId: string): Promise<void>;
  markReadyForReview(pullNodeId: string): Promise<void>;
}

const nextLink = (header: string | null): string | undefined =>
  header?.match(/<([^>]+)>;\s*rel="next"/)?.[1];

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

  async function openIssues(query: string): Promise<Issue[]> {
    return (
      await paginate<Issue & { pull_request?: unknown }>(
        `${repoPath}/issues${query}`,
      )
    ).filter((i) => i.pull_request === undefined);
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
    listCheckRuns: async (sha) =>
      (
        await paginate<{ name: string; conclusion: string | null }>(
          `${repoPath}/commits/${sha}/check-runs?filter=latest`,
          (p) =>
            (p as { check_runs: { name: string; conclusion: string | null }[] })
              .check_runs,
        )
      ).map(({ name, conclusion }) => ({ name, conclusion })),
    getPermission: async (login) =>
      (
        await json<{ permission: string }>(
          "GET",
          `${repoPath}/collaborators/${encodeURIComponent(login)}/permission`,
        )
      ).permission,
    listPullFiles: async (n) =>
      (
        await paginate<{ filename: string }>(`${repoPath}/pulls/${n}/files`)
      ).map((f) => f.filename),
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
    listOpenIssuesByLabel: (label) =>
      openIssues(`?state=open&labels=${encodeURIComponent(label)}`),
    listOpenIssues: () => openIssues("?state=open"),
    getCommitParents: async (sha) =>
      (
        await json<{ parents: { sha: string }[] }>(
          "GET",
          `${repoPath}/commits/${sha}`,
        )
      ).parents.map((p) => p.sha),
    mergePull: async (n, sha) => {
      await call("PUT", `${repoPath}/pulls/${n}/merge`, {
        merge_method: "squash",
        sha,
      });
    },
    listOpenPulls: () => paginate(`${repoPath}/pulls?state=open`),
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
