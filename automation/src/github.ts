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

interface IssueComment {
  body: string;
  created_at: string;
  user: { login: string } | null;
}

export interface GitHubClient {
  getRepo(): Promise<RepoInfo>;
  getPull(n: number): Promise<Pull>;
  listIssueEvents(n: number): Promise<IssueEvent[]>;
  getRepoFile(path: string, ref: string): Promise<string>;
  addLabels(n: number, labels: string[]): Promise<void>;
  removeLabel(n: number, label: string): Promise<void>;
  createComment(n: number, body: string): Promise<void>;
  listComments(n: number): Promise<IssueComment[]>;
  listOpenIssuesByLabel(label: string): Promise<Issue[]>;
  listOpenPulls(): Promise<Pull[]>;
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

  return {
    getRepo: () => json("GET", repoPath),
    getPull: (n) => json("GET", `${repoPath}/pulls/${n}`),
    listIssueEvents: (n) => paginate(`${repoPath}/issues/${n}/events`),
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
    listComments: (n) => paginate(`${repoPath}/issues/${n}/comments`),
    listOpenIssuesByLabel: (label) =>
      openIssues(`?state=open&labels=${encodeURIComponent(label)}`),
    listOpenPulls: () => paginate(`${repoPath}/pulls?state=open`),
  };
}
