import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./App.css";

type Skill = {
  id: string;
  name: string;
  description: string;
  path: string;
  coreFile: string;
  coreFilePath: string;
  sourceUrl?: string | null;
  sourceId: string;
  metadata: Record<string, string>;
  body: string;
  lastModified?: number;
};

type SkillSource = {
  id: string;
  label: string;
  root: string;
  exists: boolean;
  skills: Skill[];
};

type SkillTreeNode = {
  name: string;
  path: string;
  kind: "file" | "dir" | "link";
  children: SkillTreeNode[];
};

type McpServer = {
  id: string;
  config: Record<string, unknown>;
};

type McpSource = {
  id: string;
  label: string;
  path: string;
  format: "toml" | "json";
  exists: boolean;
  servers: McpServer[];
};

type ToastTone = "success" | "error" | "info";

type ToastState = {
  message: string;
  tone: ToastTone;
} | null;

type SkillForm = {
  sourceId: string;
  url: string;
};

type McpForm = {
  sourceId: string;
  json: string;
};

type DeleteIntent =
  | {
      kind: "skill";
      sourceId: string;
      skillId: string;
      name: string;
    }
  | {
      kind: "mcp";
      sourceId: string;
      id: string;
      name: string;
    };

type SkillWithSource = Skill & {
  sourceLabel: string;
  sourceRoot: string;
};

const sourcePalette: Record<
  string,
  { accent: string; soft: string; ink: string }
> = {
  all: { accent: "#1f1a16", soft: "#f5efe7", ink: "#1f1a16" },
  claude: { accent: "#3a8b6b", soft: "#d7efe6", ink: "#1f1a16" },
  codex: { accent: "#2b5da8", soft: "#dde7f7", ink: "#1f1a16" },
  opencode: { accent: "#9a7a2c", soft: "#f3ead3", ink: "#1f1a16" },
  roo: { accent: "#566b2f", soft: "#e6edd9", ink: "#1f1a16" },
  copilot: { accent: "#0f6b57", soft: "#d8efe9", ink: "#1f1a16" },
  cursor: { accent: "#b24a2d", soft: "#f6e1da", ink: "#1f1a16" },
  gemini: { accent: "#b9782a", soft: "#f4e7d6", ink: "#1f1a16" },
  trae: { accent: "#b2416e", soft: "#f3dbe7", ink: "#1f1a16" },
  goose: { accent: "#2d6d7a", soft: "#d7ecf1", ink: "#1f1a16" },
  standard: { accent: "#5b5248", soft: "#eee7dc", ink: "#1f1a16" },
  antigravity: { accent: "#7a5230", soft: "#f1e4d7", ink: "#1f1a16" },
  kiro: { accent: "#517d3b", soft: "#e1efda", ink: "#1f1a16" },
  qoder: { accent: "#3b4a78", soft: "#dfe4f1", ink: "#1f1a16" },
  codebuddy: { accent: "#7a2d2d", soft: "#f2dbdb", ink: "#1f1a16" },
};

const paletteForSource = (sourceId: string) => {
  const base = sourceId.split("-")[0];
  return sourcePalette[base] || sourcePalette.all;
};

const defaultSkillForm: SkillForm = {
  sourceId: "codex-user",
  url: "",
};

const defaultMcpJson = `{
  "mcpServers": {
    "server-id": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    }
  }
}`;

const defaultMcpForm: McpForm = {
  sourceId: "codex",
  json: defaultMcpJson,
};

const formatDate = (timestamp?: number) => {
  if (!timestamp) return "Not tracked";
  const date = new Date(timestamp * 1000);
  return date.toLocaleString();
};

const shortenPath = (value: string) => {
  if (!value) return "";
  if (value.length < 40) return value;
  return `${value.slice(0, 18)}...${value.slice(-18)}`;
};

const skillTreeKindLabel = (kind: SkillTreeNode["kind"]) => {
  if (kind === "dir") return "DIR";
  if (kind === "link") return "LINK";
  return "FILE";
};

const buildMcpJson = (server: McpServer) =>
  JSON.stringify({ mcpServers: { [server.id]: server.config } }, null, 2);

function App() {
  const [view, setView] = useState<"skills" | "mcp">("skills");
  const [sources, setSources] = useState<SkillSource[]>([]);
  const [selectedSource, setSelectedSource] = useState("all");
  const [selectedSkillKey, setSelectedSkillKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [showAddSkill, setShowAddSkill] = useState(false);
  const [skillForm, setSkillForm] = useState<SkillForm>(defaultSkillForm);
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const toastTimer = useRef<number | null>(null);

  const [skillTree, setSkillTree] = useState<SkillTreeNode | null>(null);
  const [skillTreeLoading, setSkillTreeLoading] = useState(false);
  const [skillTreeError, setSkillTreeError] = useState<string | null>(null);

  const [mcpSources, setMcpSources] = useState<McpSource[]>([]);
  const [mcpLoading, setMcpLoading] = useState(true);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [selectedMcpSource, setSelectedMcpSource] = useState("codex");
  const [selectedMcpId, setSelectedMcpId] = useState<string | null>(null);
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [mcpForm, setMcpForm] = useState<McpForm>(defaultMcpForm);

  const loadSources = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await invoke<SkillSource[]>("list_skills");
      setSources(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const loadMcp = async () => {
    setMcpLoading(true);
    setMcpError(null);
    try {
      const result = await invoke<McpSource[]>("list_mcp_sources");
      setMcpSources(result);
    } catch (err) {
      setMcpError(String(err));
    } finally {
      setMcpLoading(false);
    }
  };

  useEffect(() => {
    loadSources();
    loadMcp();
  }, []);

  useEffect(() => {
    if (sources.length === 0) return;
    if (!sources.some((source) => source.id === skillForm.sourceId)) {
      setSkillForm((current) => ({
        ...current,
        sourceId: sources[0].id,
      }));
    }
  }, [sources, skillForm.sourceId]);

  useEffect(() => {
    if (selectedSource === "all") return;
    if (!sources.some((source) => source.id === selectedSource)) {
      setSelectedSource("all");
    }
  }, [sources, selectedSource]);

  useEffect(() => {
    if (!selectedSkillKey) {
      setSkillTree(null);
      return;
    }
  }, [selectedSkillKey]);

  const allSkills = useMemo<SkillWithSource[]>(() => {
    return sources.flatMap((source) =>
      source.skills.map((skill) => ({
        ...skill,
        sourceLabel: source.label,
        sourceRoot: source.root,
      })),
    );
  }, [sources]);

  const visibleSkills = useMemo(() => {
    return selectedSource === "all"
      ? allSkills
      : allSkills.filter((skill) => skill.sourceId === selectedSource);
  }, [allSkills, selectedSource]);

  const selectedSkill = useMemo(() => {
    if (!selectedSkillKey) return null;
    return (
      allSkills.find(
        (skill) => `${skill.sourceId}:${skill.id}` === selectedSkillKey,
      ) || null
    );
  }, [allSkills, selectedSkillKey]);

  const totalSkills = allSkills.length;

  useEffect(() => {
    if (!selectedSkill) {
      setSkillTree(null);
      setSkillTreeLoading(false);
      setSkillTreeError(null);
      return;
    }

    let cancelled = false;
    setSkillTreeLoading(true);
    setSkillTreeError(null);

    invoke<SkillTreeNode>("list_skill_tree", {
      payload: {
        sourceId: selectedSkill.sourceId,
        skillId: selectedSkill.id,
      },
    })
      .then((tree) => {
        if (!cancelled) {
          setSkillTree(tree);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSkillTreeError(String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSkillTreeLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSkill?.sourceId, selectedSkill?.id]);

  const activeMcpSource = useMemo(() => {
    return mcpSources.find((source) => source.id === selectedMcpSource) || null;
  }, [mcpSources, selectedMcpSource]);

  useEffect(() => {
    if (mcpSources.length === 0) return;
    if (!mcpSources.some((source) => source.id === selectedMcpSource)) {
      setSelectedMcpSource(mcpSources[0].id);
    }
  }, [mcpSources, selectedMcpSource]);

  useEffect(() => {
    setSelectedMcpId(null);
  }, [selectedMcpSource]);

  const selectedMcp = useMemo(() => {
    if (!selectedMcpId || !activeMcpSource) return null;
    return (
      activeMcpSource.servers.find((server) => server.id === selectedMcpId) ||
      null
    );
  }, [activeMcpSource, selectedMcpId]);

  const selectedMcpJson = useMemo(() => {
    if (!selectedMcp) return "";
    return buildMcpJson(selectedMcp);
  }, [selectedMcp]);

  const totalMcpServers = useMemo(() => {
    return mcpSources.reduce((sum, source) => sum + source.servers.length, 0);
  }, [mcpSources]);

  const handleSelectSkill = (skill: SkillWithSource) => {
    setSelectedSkillKey(`${skill.sourceId}:${skill.id}`);
  };

  const showToast = (message: string, tone: ToastTone) => {
    setToast({ message, tone });
    if (toastTimer.current) {
      window.clearTimeout(toastTimer.current);
    }
    toastTimer.current = window.setTimeout(() => {
      setToast(null);
    }, 2400);
  };

  const handleOpenSkillCenter = async () => {
    try {
      await openUrl("https://skill.extrachatgpt.com/");
    } catch (err) {
      showToast(`Open failed: ${String(err)}`, "error");
    }
  };

  const handleOpenAddSkill = () => {
    const preferred =
      selectedSource !== "all" &&
      sources.some((source) => source.id === selectedSource)
        ? selectedSource
        : sources[0]?.id;
    if (preferred && preferred !== skillForm.sourceId) {
      setSkillForm((current) => ({
        ...current,
        sourceId: preferred,
      }));
    }
    setShowAddSkill(true);
  };

  const handleInstallSkill = async () => {
    if (!skillForm.url.trim()) {
      showToast("GitHub URL is required.", "error");
      return;
    }
    try {
      const created = await invoke<Skill>("install_skill_from_url", {
        payload: {
          sourceId: skillForm.sourceId,
          url: skillForm.url.trim(),
        },
      });
      await loadSources();
      setSelectedSkillKey(`${created.sourceId}:${created.id}`);
      setSkillForm(defaultSkillForm);
      setShowAddSkill(false);
      showToast("Skill installed.", "success");
    } catch (err) {
      showToast(`Install failed: ${String(err)}`, "error");
    }
  };

  const handleSyncSkill = async () => {
    if (!selectedSkill?.sourceUrl || syncLoading) return;
    const skillKey = `${selectedSkill.sourceId}:${selectedSkill.id}`;
    try {
      setSyncLoading(true);
      await invoke<Skill>("sync_skill_from_url", {
        payload: {
          sourceId: selectedSkill.sourceId,
          skillId: selectedSkill.id,
          url: selectedSkill.sourceUrl,
        },
      });
      await loadSources();
      setSelectedSkillKey(skillKey);
      showToast("Skill synced.", "success");
    } catch (err) {
      showToast(`Sync failed: ${String(err)}`, "error");
    } finally {
      setSyncLoading(false);
    }
  };

  const handleRequestDeleteSkill = () => {
    if (!selectedSkill) return;
    setDeleteIntent({
      kind: "skill",
      sourceId: selectedSkill.sourceId,
      skillId: selectedSkill.id,
      name: selectedSkill.name,
    });
  };

  const handleDeleteSkill = async (sourceId: string, skillId: string) => {
    try {
      await invoke("delete_skill", {
        payload: {
          sourceId,
          skillId,
        },
      });
      setSelectedSkillKey(null);
      await loadSources();
      showToast("Skill deleted.", "success");
    } catch (err) {
      showToast(`Delete failed: ${String(err)}`, "error");
    }
  };

  const handleRefreshSkills = async () => {
    await loadSources();
    showToast("Agents refreshed.", "info");
  };

  const handleRefreshMcp = async () => {
    await loadMcp();
    showToast("MCP servers refreshed.", "info");
  };

  const handleOpenAddMcp = () => {
    setMcpForm({
      sourceId: selectedMcpSource || "codex",
      json: defaultMcpJson,
    });
    setShowAddMcp(true);
  };

  const handleSaveMcp = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(mcpForm.json);
    } catch (err) {
      showToast("Invalid JSON format.", "error");
      return;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      showToast("JSON must be an object.", "error");
      return;
    }

    const servers = (parsed as { mcpServers?: unknown }).mcpServers;
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
      showToast("JSON must include mcpServers object.", "error");
      return;
    }

    try {
      await invoke("upsert_mcp_server_json", {
        payload: {
          sourceId: mcpForm.sourceId,
          json: mcpForm.json,
        },
      });
      await loadMcp();
      setShowAddMcp(false);
      setMcpForm(defaultMcpForm);
      showToast("MCP server saved.", "success");
    } catch (err) {
      showToast(`Save failed: ${String(err)}`, "error");
    }
  };

  const handleRequestDeleteMcp = () => {
    if (!selectedMcp || !activeMcpSource) return;
    setDeleteIntent({
      kind: "mcp",
      sourceId: activeMcpSource.id,
      id: selectedMcp.id,
      name: selectedMcp.id,
    });
  };

  const handleDeleteMcp = async (sourceId: string, id: string) => {
    try {
      await invoke("delete_mcp_server", {
        payload: {
          sourceId,
          id,
        },
      });
      setSelectedMcpId(null);
      await loadMcp();
      showToast("MCP server deleted.", "success");
    } catch (err) {
      showToast(`Delete failed: ${String(err)}`, "error");
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteIntent) return;
    const intent = deleteIntent;
    setDeleteIntent(null);
    if (intent.kind === "skill") {
      await handleDeleteSkill(intent.sourceId, intent.skillId);
      return;
    }
    await handleDeleteMcp(intent.sourceId, intent.id);
  };

  const handleEditMcp = () => {
    if (!selectedMcp || !activeMcpSource) return;
    setMcpForm({
      sourceId: activeMcpSource.id,
      json: buildMcpJson(selectedMcp),
    });
    setShowAddMcp(true);
  };

  const sourceCount = (sourceId: string) =>
    sourceId === "all"
      ? totalSkills
      : sources.find((source) => source.id === sourceId)?.skills.length || 0;

  const renderTreeNode = (node: SkillTreeNode) => {
    return (
      <div key={node.path} className={`tree-node ${node.kind}`}>
        <div className="tree-row">
          <span className="tree-kind">{skillTreeKindLabel(node.kind)}</span>
          <span className="tree-name">{node.name}</span>
        </div>
        {node.children.length > 0 && (
          <div className="tree-children">
            {node.children.map((child) => renderTreeNode(child))}
          </div>
        )}
      </div>
    );
  };

  const selectedMcpLabel = activeMcpSource?.label || "";
  const currentYear = new Date().getFullYear();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-title">Ananke</div>
          <div className="brand-sub">
            One Place for Skills & MCP.
          </div>
          <div className="brand-meta">
            {view === "skills" ? (
              <>
                <div className="meta-chip">{totalSkills} skills</div>
              </>
            ) : (
              <>
                <div className="meta-chip">{totalMcpServers} MCP servers</div>
                <div className="meta-chip">
                  Agent: {selectedMcpLabel || "Unselected"}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="controls">
          <div className="view-toggle">
            <button
              className={`toggle-pill ${view === "skills" ? "active" : ""}`}
              onClick={() => setView("skills")}
            >
              Skills
            </button>
            <button
              className={`toggle-pill ${view === "mcp" ? "active" : ""}`}
              onClick={() => setView("mcp")}
            >
              MCP
            </button>
          </div>
          <div className="control-buttons">
            {view === "skills" ? (
              <>
                <button
                  className="btn btn-primary"
                  onClick={handleOpenAddSkill}
                >
                  Install skill
                </button>
                <button
                  className="btn btn-ghost btn-external"
                  onClick={handleOpenSkillCenter}
                >
                  Skill Center
                  <svg
                    className="external-icon"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      d="M14 4h6v6M10 14L20 4M20 14v6H4V4h6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <button className="btn btn-ghost" onClick={handleRefreshSkills}>
                  Refresh
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-primary" onClick={handleOpenAddMcp}>
                  Add MCP server
                </button>
                <button className="btn btn-ghost" onClick={handleRefreshMcp}>
                  Refresh
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {view === "skills" ? (
        <section className="panel-grid">
          <aside className="panel sources">
            <div className="panel-header">
              <h2>AI Coding Agents</h2>
              <span className="panel-sub">Pick a scope</span>
            </div>

            <button
              className={`source-card ${
                selectedSource === "all" ? "active" : ""
              }`}
              style={
                {
                  "--accent": sourcePalette.all.accent,
                  "--accent-soft": sourcePalette.all.soft,
                } as CSSProperties
              }
              onClick={() => setSelectedSource("all")}
            >
              <div className="source-title">All Agents</div>
              <div className="source-meta">
                <span>{sourceCount("all")} skills</span>
                <span className="status-pill">Unified view</span>
              </div>
            </button>

            <div className="source-list">
              {sources.map((source) => {
                const palette = paletteForSource(source.id);
                return (
                  <button
                    key={source.id}
                    className={`source-card ${
                      selectedSource === source.id ? "active" : ""
                    }`}
                    style={
                      {
                        "--accent": palette.accent,
                        "--accent-soft": palette.soft,
                      } as CSSProperties
                    }
                    onClick={() => setSelectedSource(source.id)}
                  >
                    <div className="source-title">{source.label}</div>
                    <div className="source-meta">
                      <span>{source.skills.length} skills</span>
                      <span className="status-pill">
                        {source.exists ? "Ready" : "Missing"}
                      </span>
                    </div>
                    <div className="source-path">{shortenPath(source.root)}</div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="panel skills">
            <div className="panel-header">
              <h2>Installed Skills</h2>
              <span className="panel-sub">
                {selectedSource === "all"
                  ? "All agents"
                  : sources.find((source) => source.id === selectedSource)?.label}
              </span>
            </div>

            {isLoading ? (
              <div className="empty-state">Indexing skills...</div>
            ) : error ? (
              <div className="empty-state error">{error}</div>
            ) : visibleSkills.length === 0 ? (
              <div className="empty-state">No skills match this filter.</div>
            ) : (
              <div className="skill-list">
                {visibleSkills.map((skill, index) => {
                  const palette = paletteForSource(skill.sourceId);
                  const isActive =
                    selectedSkillKey === `${skill.sourceId}:${skill.id}`;
                  const tags = Object.keys(skill.metadata || {})
                    .filter((key) => {
                      const normalized = key.toLowerCase();
                      return !["name", "description", "license"].includes(
                        normalized,
                      );
                    })
                    .slice(0, 3);

                  return (
                    <button
                      key={`${skill.sourceId}:${skill.id}`}
                      className={`skill-card ${isActive ? "active" : ""}`}
                      style={
                        {
                          "--accent": palette.accent,
                          "--delay": `${index * 0.04}s`,
                        } as CSSProperties
                      }
                      onClick={() => handleSelectSkill(skill)}
                    >
                      <div className="skill-top">
                        <div>
                          <div className="skill-name">{skill.name}</div>
                          <div className="skill-desc">
                            {skill.description || "No description"}
                          </div>
                        </div>
                        <span className="source-pill">{skill.sourceLabel}</span>
                      </div>
                      <div className="skill-meta">
                        <span>{shortenPath(skill.path)}</span>
                        <span>{formatDate(skill.lastModified)}</span>
                      </div>
                      {tags.length > 0 && (
                        <div className="chip-row">
                          {tags.map((tag) => (
                            <span key={tag} className="chip">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="panel detail">
            <div className="panel-header">
              <h2>Skill Details</h2>
              <span className="panel-sub">Full instructions</span>
            </div>

            {!selectedSkill ? (
              <div className="empty-state">Select a skill to inspect.</div>
            ) : (
              <div className="detail-content">
                <div className="detail-header">
                  <div>
                    <h3>{selectedSkill.name}</h3>
                    <p>{selectedSkill.description || "No description"}</p>
                  </div>
                  <span className="source-pill">
                    {selectedSkill.sourceLabel}
                  </span>
                </div>

                <div className="detail-grid">
                  <div>
                    <div className="detail-label">Path</div>
                    <div className="detail-value detail-path">
                      <span>{selectedSkill.path}</span>
                    </div>
                  </div>
                  <div>
                    <div className="detail-label">Last modified</div>
                    <div className="detail-value">
                      {formatDate(selectedSkill.lastModified)}
                    </div>
                  </div>
                  <div>
                    <div className="detail-label">Agent root</div>
                    <div className="detail-value">
                      {selectedSkill.sourceRoot}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="detail-label">Directory tree</div>
                  {skillTreeLoading ? (
                    <div className="empty-state">Loading tree...</div>
                  ) : skillTreeError ? (
                    <div className="empty-state error">{skillTreeError}</div>
                  ) : skillTree ? (
                    <div className="tree">{renderTreeNode(skillTree)}</div>
                  ) : (
                    <div className="empty-state">No tree data.</div>
                  )}
                </div>

                <div>
                  <div className="detail-label">SKILL.md content</div>
                  <pre className="detail-body">{selectedSkill.body}</pre>
                </div>

                <div className="detail-actions">
                  {selectedSkill.sourceUrl ? (
                    <button
                      className="btn btn-ghost"
                      onClick={handleSyncSkill}
                      disabled={syncLoading}
                    >
                      {syncLoading ? "Syncing..." : "Sync latest"}
                    </button>
                  ) : null}
                  <button
                    className="btn btn-danger"
                    onClick={handleRequestDeleteSkill}
                  >
                    Delete skill
                  </button>
                </div>
              </div>
            )}
          </aside>
        </section>
      ) : (
        <section className="panel-grid">
          <aside className="panel sources">
            <div className="panel-header">
              <h2>AI Coding Agents</h2>
              <span className="panel-sub">MCP scopes</span>
            </div>

            <div className="source-list">
              {mcpSources.map((source) => {
                const palette = paletteForSource(source.id);
                return (
                  <button
                    key={source.id}
                    className={`source-card ${
                      selectedMcpSource === source.id ? "active" : ""
                    }`}
                    style={
                      {
                        "--accent": palette.accent,
                        "--accent-soft": palette.soft,
                      } as CSSProperties
                    }
                    onClick={() => setSelectedMcpSource(source.id)}
                  >
                    <div className="source-title">{source.label}</div>
                    <div className="source-meta">
                      <span>{source.servers.length} servers</span>
                      <span className="status-pill">
                        {source.exists ? "Ready" : "Missing"}
                      </span>
                    </div>
                    <div className="source-path">{shortenPath(source.path)}</div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="panel mcp-list">
            <div className="panel-header">
              <h2>MCP Servers</h2>
              <span className="panel-sub">
                {activeMcpSource?.label || "Select an agent"}
              </span>
            </div>

            {activeMcpSource && (
              <div className="mcp-path">{activeMcpSource.path}</div>
            )}

            {mcpLoading ? (
              <div className="empty-state">Loading MCP servers...</div>
            ) : mcpError ? (
              <div className="empty-state error">{mcpError}</div>
            ) : !activeMcpSource ? (
              <div className="empty-state">Select an agent to view MCP.</div>
            ) : activeMcpSource.servers.length === 0 ? (
              <div className="empty-state">No MCP servers configured.</div>
            ) : (
              <div className="mcp-list-grid">
                {activeMcpSource.servers.map((server, index) => {
                  const config = server.config || {};
                  const command =
                    typeof config.command === "string" ? config.command : null;
                  const url = typeof config.url === "string" ? config.url : null;
                  const args = Array.isArray(config.args)
                    ? config.args.length
                    : 0;

                  return (
                    <button
                      key={server.id}
                      className={`mcp-card ${
                        selectedMcpId === server.id ? "active" : ""
                      }`}
                      style={
                        {
                          "--delay": `${index * 0.05}s`,
                        } as CSSProperties
                      }
                      onClick={() => setSelectedMcpId(server.id)}
                    >
                      <div className="mcp-title">{server.id}</div>
                      <div className="mcp-meta">
                        {url ? <span>url: {url}</span> : null}
                        {command ? <span>cmd: {command}</span> : null}
                        {!url && !command ? (
                          <span>{Object.keys(config).length} fields</span>
                        ) : null}
                        {args ? <span>{args} args</span> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="panel mcp-detail">
            <div className="panel-header">
              <h2>MCP Details</h2>
              <span className="panel-sub">JSON format</span>
            </div>

            {!selectedMcp ? (
              <div className="empty-state">Select an MCP server.</div>
            ) : (
              <div className="detail-content">
                <div className="detail-header">
                  <div>
                    <h3>{selectedMcp.id}</h3>
                    <p>{selectedMcpLabel || "Unknown agent"}</p>
                  </div>
                  <span className="source-pill">
                    {activeMcpSource?.label || "Agent"}
                  </span>
                </div>

                <div>
                  <div className="detail-label">mcpServers JSON</div>
                  <pre className="detail-body">{selectedMcpJson}</pre>
                </div>

                <div className="detail-actions">
                  <button className="btn btn-ghost" onClick={handleEditMcp}>
                    Edit JSON
                  </button>
                  <button className="btn btn-danger" onClick={handleRequestDeleteMcp}>
                    Delete server
                  </button>
                </div>
              </div>
            )}
          </aside>
        </section>
      )}

      {showAddSkill && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-header">
              <div>
                <h3>Install skill from GitHub</h3>
                <p>Pick an agent and provide a GitHub directory URL.</p>
              </div>
              <button
                className="btn btn-ghost"
                onClick={() => setShowAddSkill(false)}
              >
                Close
              </button>
            </div>

            <div className="modal-grid">
              <label>
                <span>Target agent</span>
                <select
                  value={skillForm.sourceId}
                  onChange={(event) =>
                    setSkillForm((current) => ({
                      ...current,
                      sourceId: event.target.value,
                    }))
                  }
                >
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="full">
                <span>GitHub directory URL</span>
                <input
                  value={skillForm.url}
                  onChange={(event) =>
                    setSkillForm((current) => ({
                      ...current,
                      url: event.target.value,
                    }))
                  }
                  placeholder="https://github.com/org/repo/tree/main/skills/example"
                />
              </label>
            </div>

            <div className="modal-footer">
              <button className="btn btn-primary" onClick={handleInstallSkill}>
                Install skill
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteIntent && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-header">
              <div>
                <h3>
                  {deleteIntent.kind === "skill"
                    ? "Delete skill"
                    : "Delete MCP server"}
                </h3>
                <p>This cannot be undone.</p>
              </div>
              <button
                className="btn btn-ghost"
                onClick={() => setDeleteIntent(null)}
              >
                Close
              </button>
            </div>

            <div className="modal-grid">
              <label className="full">
                <span>
                  {deleteIntent.kind === "skill" ? "Skill" : "Server"}
                </span>
                <input value={deleteIntent.name} readOnly />
              </label>
            </div>

            <div className="modal-footer">
              <button
                className="btn btn-ghost"
                onClick={() => setDeleteIntent(null)}
              >
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleConfirmDelete}>
                {deleteIntent.kind === "skill" ? "Delete skill" : "Delete server"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddMcp && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-header">
              <div>
                <h3>Register MCP server</h3>
                <p>Paste MCP JSON for the selected agent.</p>
              </div>
              <button
                className="btn btn-ghost"
                onClick={() => setShowAddMcp(false)}
              >
                Close
              </button>
            </div>

            <div className="modal-grid">
              <label>
                <span>Target agent</span>
                <select
                  value={mcpForm.sourceId}
                  onChange={(event) =>
                    setMcpForm((current) => ({
                      ...current,
                      sourceId: event.target.value,
                    }))
                  }
                >
                  {mcpSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="full">
                <span>MCP JSON</span>
                <textarea
                  value={mcpForm.json}
                  onChange={(event) =>
                    setMcpForm((current) => ({
                      ...current,
                      json: event.target.value,
                    }))
                  }
                  placeholder={defaultMcpJson}
                />
              </label>
            </div>

            <div className="modal-footer">
              <button className="btn btn-primary" onClick={handleSaveMcp}>
                Save MCP
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <span className="footer-text">Copyright {currentYear} Ananke</span>
        <span className="footer-sep">|</span>
        <button className="footer-link" onClick={handleOpenSkillCenter}>
          SKILL.md registry
          <svg className="footer-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M14 4h6v6M10 14L20 4M20 14v6H4V4h6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </footer>

      {toast && (
        <div className={`toast ${toast.tone}`} role="status">
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default App;
