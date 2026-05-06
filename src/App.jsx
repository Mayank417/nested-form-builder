import React, { useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "nested-form-attractive-v6";

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `q_${Date.now()}_${Math.random().toString(16).slice(2)}`;

const createQuestion = () => ({
  id: uid(),
  text: "",
  type: "short_answer",
  answer: "True",
  children: [],
});

function normalizeQuestion(raw) {
  return {
    id: typeof raw?.id === "string" ? raw.id : uid(),
    text: typeof raw?.text === "string" ? raw.text : "",
    type: raw?.type === "true_false" ? "true_false" : "short_answer",
    answer: raw?.answer === "False" ? "False" : "True",
    children: Array.isArray(raw?.children) ? raw.children.map(normalizeQuestion) : [],
  };
}

function sanitizeQuestions(value) {
  if (!Array.isArray(value) || value.length === 0) return [createQuestion()];
  return value.map(normalizeQuestion);
}

function safeLoad() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [createQuestion()];
    const parsed = JSON.parse(raw);
    return sanitizeQuestions(parsed);
  } catch {
    return [createQuestion()];
  }
}

function decodeBase64Url(input) {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function getInitialAppState() {
  if (typeof window === "undefined") {
    return {
      questions: [createQuestion()],
      mode: "builder",
      isSharedSession: false,
    };
  }

  const params = new URLSearchParams(window.location.search);
  const formToken = params.get("form");
  const modeFromUrl = params.get("mode");

  if (formToken) {
    try {
      const decoded = decodeBase64Url(formToken);
      const parsed = JSON.parse(decoded);
      const questions = sanitizeQuestions(parsed);
      return {
        questions,
        mode: "fill",
        isSharedSession: true,
      };
    } catch {
      return {
        questions: [createQuestion()],
        mode: "fill",
        isSharedSession: true,
      };
    }
  }

  return {
    questions: safeLoad(),
    mode: modeFromUrl === "fill" ? "fill" : "builder",
    isSharedSession: false,
  };
}

function numberTree(list, prefix = "") {
  return list.map((q, idx) => {
    const current = prefix ? `${prefix}.${idx + 1}` : `${idx + 1}`;
    return {
      ...q,
      displayNumber: `Q${current}`,
      children: numberTree(q.children || [], current),
    };
  });
}

function collectIds(tree, ids = []) {
  tree.forEach((q) => {
    ids.push(q.id);
    if (q.children?.length) collectIds(q.children, ids);
  });
  return ids;
}

function addChildById(tree, id, childToAdd) {
  return tree.map((q) => {
    if (q.id === id) {
      return { ...q, children: [...(q.children || []), childToAdd] };
    }
    return { ...q, children: addChildById(q.children || [], id, childToAdd) };
  });
}

function updateById(tree, id, updater) {
  return tree.map((q) => {
    if (q.id === id) return updater(q);
    return { ...q, children: updateById(q.children || [], id, updater) };
  });
}

function removeById(tree, id) {
  return tree
    .filter((q) => q.id !== id)
    .map((q) => ({ ...q, children: removeById(q.children || [], id) }));
}

function getIdFromPath(tree, path) {
  let current = tree[path[0]];
  for (let i = 1; i < path.length; i += 1) {
    current = current.children[path[i]];
  }
  return current.id;
}

function moveTopLevel(list, index, direction) {
  const next = [...list];
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= next.length) return list;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function buildSubmissionTree(questions, answers) {
  return questions.map((q) => {
    const value = answers[q.id] ?? "";
    const node = {
      id: q.id,
      number: q.displayNumber,
      text: q.text || "Untitled question",
      type: q.type,
      answer: value,
    };

    if (q.type === "true_false" && value === "True" && q.children?.length) {
      node.children = buildSubmissionTree(q.children, answers);
    } else {
      node.children = [];
    }

    return node;
  });
}

function QuestionCard({
  question,
  path,
  onUpdate,
  onDelete,
  onAddChild,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  depth = 0,
  registerRef,
}) {
  const isTrueFalse = question.type === "true_false";
  const canShowChildButton = isTrueFalse && question.answer === "True";

  return (
    <div
      ref={(el) => registerRef(question.id, el)}
      className="question-shell"
      style={{ marginLeft: depth > 0 ? 18 : 0 }}
    >
      <div className="question-card">
        <div className="question-top">
          <div className="question-number">{question.displayNumber}</div>

          <div className="question-main">
            <input
              value={question.text}
              onChange={(e) => onUpdate(path, { text: e.target.value })}
              placeholder="Type your question here..."
              className="question-input"
            />

            <div className="question-controls">
              <div className="control-group">
                <label>Question Type</label>
                <select
                  value={question.type}
                  onChange={(e) => {
                    const nextType = e.target.value;
                    onUpdate(path, {
                      type: nextType,
                      answer: "True",
                      children: nextType === "true_false" ? question.children : [],
                    });
                  }}
                  className="question-select"
                >
                  <option value="short_answer">Short Answer</option>
                  <option value="true_false">True / False</option>
                </select>
              </div>

              {isTrueFalse && (
                <div className="control-group">
                  <label>Logic Answer</label>
                  <select
                    value={question.answer}
                    onChange={(e) => onUpdate(path, { answer: e.target.value })}
                    className="question-select"
                  >
                    <option value="True">True (show child)</option>
                    <option value="False">False (hide child)</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            className="icon-button danger"
            onClick={() => onDelete(path)}
            title="Delete question"
          >
            ×
          </button>
        </div>

        <div className="question-actions">
          {canShowChildButton && (
            <button type="button" className="secondary-button" onClick={() => onAddChild(path)}>
              + Add Sub-Question
            </button>
          )}

          {path.length === 1 && (
            <div className="move-group">
              <button
                type="button"
                className="ghost-button"
                onClick={() => onMoveUp(path)}
                disabled={!canMoveUp}
              >
                ↑ Up
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => onMoveDown(path)}
                disabled={!canMoveDown}
              >
                ↓ Down
              </button>
            </div>
          )}
        </div>
      </div>

      {question.children?.length > 0 && (
        <div className="nested-section">
          {question.children.map((child, idx) => (
            <QuestionCard
              key={child.id}
              question={child}
              path={[...path, idx]}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onAddChild={onAddChild}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              canMoveUp={false}
              canMoveDown={false}
              depth={depth + 1}
              registerRef={registerRef}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PreviewTree({ questions }) {
  if (!questions.length) {
    return <div className="empty-state">No submitted questions yet.</div>;
  }

  return (
    <div className="preview-tree">
      {questions.map((q) => (
        <div key={q.id} className="preview-node">
          <div className="preview-title">
            {q.displayNumber}. {q.text || "Untitled question"}
          </div>
          <div className="preview-meta">
            Type: {q.type === "true_false" ? "True / False" : "Short Answer"}
            {q.type === "true_false" ? ` • Answer: ${q.answer}` : ""}
          </div>
          {q.children?.length > 0 && (
            <div className="preview-child-wrap">
              <PreviewTree questions={q.children} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SubmittedTree({ questions }) {
  if (!questions?.length) {
    return <div className="empty-state">Submit the form to see the filled response.</div>;
  }

  return (
    <div className="preview-tree">
      {questions.map((q) => (
        <div key={q.id} className="preview-node">
          <div className="preview-title">
            {q.number}. {q.text}
          </div>
          <div className="preview-meta">Answer: {q.answer || "—"}</div>

          {q.children?.length > 0 && (
            <div className="preview-child-wrap">
              <SubmittedTree questions={q.children} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FillQuestion({ question, answers, setAnswers, depth = 0 }) {
  const value = answers[question.id] ?? "";
  const isTrueFalse = question.type === "true_false";
  const showChildren = isTrueFalse && value === "True";

  return (
    <div className="fill-shell" style={{ marginLeft: depth > 0 ? 18 : 0 }}>
      <div className="fill-card">
        <div className="fill-number">{question.displayNumber}</div>

        <div className="fill-main">
          <div className="fill-title">{question.text || "Untitled question"}</div>

          {question.type === "short_answer" ? (
            <input
              className="fill-input"
              value={value}
              onChange={(e) =>
                setAnswers((prev) => ({
                  ...prev,
                  [question.id]: e.target.value,
                }))
              }
              placeholder="Your answer..."
            />
          ) : (
            <select
              className="fill-select"
              value={value}
              onChange={(e) =>
                setAnswers((prev) => ({
                  ...prev,
                  [question.id]: e.target.value,
                }))
              }
            >
              <option value="">Select answer</option>
              <option value="True">True</option>
              <option value="False">False</option>
            </select>
          )}
        </div>
      </div>

      {showChildren && question.children?.length > 0 && (
        <div className="nested-fill">
          {question.children.map((child) => (
            <FillQuestion
              key={child.id}
              question={child}
              answers={answers}
              setAnswers={setAnswers}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const initial = useMemo(() => getInitialAppState(), []);
  const [questions, setQuestions] = useState(initial.questions);
  const [preview, setPreview] = useState(null);
  const [pendingScrollId, setPendingScrollId] = useState(null);
  const [mode, setMode] = useState(initial.mode);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(null);
  const [submitStatus, setSubmitStatus] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const refsMap = useRef({});

  const isSharedSession = initial.isSharedSession;

  useEffect(() => {
    if (isSharedSession) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(questions));
  }, [questions, isSharedSession]);

  useEffect(() => {
    if (!pendingScrollId) return;
    const el = refsMap.current[pendingScrollId];
    if (el) {
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      setPendingScrollId(null);
    }
  }, [questions, pendingScrollId]);

  useEffect(() => {
    const ids = new Set(collectIds(questions));
    setAnswers((prev) => {
      const next = {};
      for (const [k, v] of Object.entries(prev)) {
        if (ids.has(k)) next[k] = v;
      }
      return next;
    });
  }, [questions]);

  const numberedQuestions = useMemo(() => numberTree(questions), [questions]);

  const registerRef = (id, el) => {
    if (el) {
      refsMap.current[id] = el;
    } else {
      delete refsMap.current[id];
    }
  };

  const handleUpdate = (path, patch) => {
    const id = getIdFromPath(questions, path);
    setQuestions((prev) => updateById(prev, id, (q) => ({ ...q, ...patch })));
  };

  const handleDelete = (path) => {
    const id = getIdFromPath(questions, path);
    setQuestions((prev) => removeById(prev, id));
  };

  const handleAddChild = (path) => {
    const parentId = getIdFromPath(questions, path);
    const newChild = createQuestion();
    setQuestions((prev) => addChildById(prev, parentId, newChild));
    setPendingScrollId(newChild.id);
  };

  const handleMove = (path, direction) => {
    if (path.length !== 1) return;
    setQuestions((prev) => moveTopLevel(prev, path[0], direction));
  };

  const handleReset = () => {
    if (!window.confirm("Reset the entire form?")) return;
    const fresh = [createQuestion()];
    setQuestions(fresh);
    setPreview(null);
    setAnswers({});
    setSubmitted(null);
    setSubmitStatus("");
    setShareLink("");
    setShareStatus("");
    if (!isSharedSession) localStorage.removeItem(STORAGE_KEY);
  };

  const handlePreview = () => {
    setPreview(numberTree(questions));
  };

  const handleAddParent = () => {
    const newParent = createQuestion();
    setQuestions((prev) => [...prev, newParent]);
    setPendingScrollId(newParent.id);
  };

  const handleSubmitFill = (e) => {
    e.preventDefault();
    setSubmitted(buildSubmissionTree(numberTree(questions), answers));
    setSubmitStatus("Form successfully submitted");
  };

  const handleCreateShareLink = async () => {
    try {
      const payload = encodeBase64Url(JSON.stringify(questions));
      const baseUrl = `${window.location.origin}${window.location.pathname}`;
      const url = `${baseUrl}?mode=fill&form=${payload}`;
      setShareLink(url);
      setShareStatus("Link ready");
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setShareStatus("Link copied");
      }
    } catch {
      setShareStatus("Could not create link");
    }
  };

  const handleCopyShareLink = async () => {
    if (!shareLink) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareLink);
        setShareStatus("Link copied");
      }
    } catch {
      setShareStatus("Copy failed");
    }
  };

  const handleOpenFillMode = () => {
    setMode("fill");
  };

  const handleBackToBuilder = () => {
    setMode("builder");
  };

  return (
    <div className="page-shell">
      <style>{`
        * { box-sizing: border-box; }
        html, body, #root { height: 100%; }
        body {
          margin: 0;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          background:
            radial-gradient(circle at top left, rgba(99,102,241,.32), transparent 28%),
            radial-gradient(circle at top right, rgba(16,185,129,.18), transparent 24%),
            linear-gradient(180deg, #0b1020 0%, #0f172a 45%, #111827 100%);
          color: #e5e7eb;
        }
        button, input, select { font: inherit; }
        .page-shell {
          min-height: 100vh;
          padding: 32px 16px 120px;
        }
        .container {
          max-width: 1250px;
          margin: 0 auto;
        }
        .hero {
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,.08);
          background: rgba(15, 23, 42, .60);
          backdrop-filter: blur(18px);
          border-radius: 28px;
          padding: 34px 28px 30px;
          box-shadow: 0 30px 80px rgba(0,0,0,.35);
          margin-bottom: 24px;
          text-align: center;
        }
        .hero::after {
          content: '';
          position: absolute;
          inset: auto -10% -40% auto;
          width: 320px;
          height: 320px;
          background: radial-gradient(circle, rgba(168,85,247,.30), transparent 65%);
          pointer-events: none;
        }
        .hero h1 {
          margin: 10px auto 12px;
          font-size: clamp(34px, 5vw, 62px);
          line-height: .95;
          letter-spacing: -0.04em;
          background: linear-gradient(90deg, #f8fafc 0%, #c4b5fd 40%, #60a5fa 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          max-width: 900px;
        }
        .hero p {
          max-width: 820px;
          margin: 0 auto;
          color: #94a3b8;
          font-size: 16px;
          line-height: 1.7;
        }
        .hero-top-row {
          display: flex;
          justify-content: center;
        }
        .mode-switch {
          display: inline-flex;
          border-radius: 18px;
          padding: 6px;
          background: rgba(255,255,255,.06);
          border: 1px solid rgba(255,255,255,.10);
          gap: 6px;
          margin-bottom: 18px;
        }
        .mode-button {
          border: 0;
          padding: 10px 16px;
          border-radius: 14px;
          cursor: pointer;
          font-weight: 800;
          color: #cbd5e1;
          background: transparent;
        }
        .mode-button.active {
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          color: white;
          box-shadow: 0 10px 24px rgba(99,102,241,.22);
        }
        .toolbar {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 22px;
          justify-content: center;
          align-items: center;
        }
        .share-box {
          margin: 18px auto 0;
          max-width: 860px;
          display: grid;
          gap: 10px;
          text-align: left;
        }
        .share-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 10px;
          align-items: center;
        }
        .share-input {
          width: 100%;
          border-radius: 16px;
          border: 1px solid rgba(148,163,184,.22);
          background: rgba(15, 23, 42, .78);
          color: #f8fafc;
          padding: 14px 16px;
          outline: none;
        }
        .share-status {
          font-size: 13px;
          color: #94a3b8;
          min-height: 18px;
        }
        .primary-button, .secondary-button, .ghost-button, .preview-button, .reset-button, .fill-submit-button, .share-button {
          border: 0;
          cursor: pointer;
          transition: transform .2s ease, box-shadow .2s ease, background .2s ease, opacity .2s ease;
        }
        .primary-button:hover, .secondary-button:hover, .preview-button:hover, .reset-button:hover, .ghost-button:hover, .fill-submit-button:hover, .mode-button:hover, .share-button:hover {
          transform: translateY(-1px);
        }
        .primary-button {
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          color: white;
          padding: 14px 18px;
          border-radius: 18px;
          font-weight: 800;
          box-shadow: 0 14px 30px rgba(99,102,241,.28);
        }
        .reset-button {
          background: rgba(255,255,255,.06);
          color: #e2e8f0;
          padding: 14px 18px;
          border-radius: 18px;
          font-weight: 700;
          border: 1px solid rgba(255,255,255,.10);
        }
        .share-button {
          background: rgba(255,255,255,.06);
          color: #e2e8f0;
          padding: 14px 18px;
          border-radius: 18px;
          font-weight: 700;
          border: 1px solid rgba(255,255,255,.10);
        }
        .layout {
          display: grid;
          grid-template-columns: 1.65fr .95fr;
          gap: 22px;
          align-items: start;
        }
        .panel {
          border-radius: 28px;
          border: 1px solid rgba(255,255,255,.08);
          background: rgba(15, 23, 42, .72);
          backdrop-filter: blur(18px);
          box-shadow: 0 20px 60px rgba(0,0,0,.25);
        }
        .panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 22px 22px 0;
          flex-wrap: wrap;
        }
        .panel-head h2 {
          margin: 0;
          font-size: 20px;
          color: #f8fafc;
        }
        .counter {
          font-size: 12px;
          color: #cbd5e1;
          background: rgba(255,255,255,.06);
          border: 1px solid rgba(255,255,255,.08);
          padding: 7px 12px;
          border-radius: 999px;
        }
        .panel-body {
          padding: 22px;
        }
        .card-stack {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .question-shell {
          position: relative;
        }
        .question-card {
          position: relative;
          overflow: hidden;
          border-radius: 24px;
          border: 1px solid rgba(255,255,255,.10);
          background: linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.03));
          padding: 18px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.04);
        }
        .question-card::before {
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 4px;
          background: linear-gradient(180deg, #6366f1, #22c55e);
          opacity: .85;
        }
        .question-top {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 14px;
          align-items: start;
        }
        .question-number {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 56px;
          height: 42px;
          padding: 0 14px;
          border-radius: 14px;
          background: linear-gradient(135deg, #6366f1, #818cf8);
          color: white;
          font-weight: 800;
          box-shadow: 0 10px 22px rgba(99,102,241,.25);
        }
        .question-main { min-width: 0; }
        .question-input, .question-select, .fill-input, .fill-select {
          width: 100%;
          border-radius: 16px;
          border: 1px solid rgba(148,163,184,.22);
          background: rgba(15, 23, 42, .75);
          color: #f8fafc;
          outline: none;
          transition: border-color .2s ease, box-shadow .2s ease, transform .2s ease;
        }
        .question-input, .fill-input {
          padding: 14px 16px;
          font-size: 15px;
          margin-bottom: 14px;
        }
        .question-input::placeholder, .fill-input::placeholder { color: #64748b; }
        .question-input:focus, .question-select:focus, .fill-input:focus, .fill-select:focus, .share-input:focus {
          border-color: rgba(129,140,248,.95);
          box-shadow: 0 0 0 4px rgba(99,102,241,.18);
        }
        .question-controls {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .control-group label {
          display: block;
          margin: 0 0 8px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: .08em;
          text-transform: uppercase;
          color: #94a3b8;
        }
        .question-select, .fill-select {
          padding: 13px 14px;
        }
        .question-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-top: 14px;
          flex-wrap: wrap;
        }
        .secondary-button {
          padding: 11px 16px;
          border-radius: 14px;
          background: rgba(16,185,129,.12);
          border: 1px solid rgba(16,185,129,.32);
          color: #6ee7b7;
          font-weight: 700;
        }
        .secondary-button:hover { background: rgba(16,185,129,.18); }
        .move-group {
          display: flex;
          gap: 10px;
        }
        .ghost-button {
          padding: 11px 14px;
          border-radius: 14px;
          background: rgba(255,255,255,.05);
          color: #e2e8f0;
          border: 1px solid rgba(255,255,255,.08);
          font-weight: 700;
        }
        .ghost-button:disabled {
          opacity: .35;
          cursor: not-allowed;
          transform: none;
        }
        .icon-button {
          width: 42px;
          height: 42px;
          border-radius: 14px;
          display: grid;
          place-items: center;
          border: 1px solid rgba(255,255,255,.10);
          background: rgba(255,255,255,.05);
          color: #e2e8f0;
          font-size: 26px;
          line-height: 1;
          flex: 0 0 auto;
        }
        .icon-button.danger:hover {
          color: #fb7185;
          border-color: rgba(251,113,133,.35);
          background: rgba(251,113,133,.08);
        }
        .nested-section, .nested-fill {
          margin-top: 14px;
          margin-left: 18px;
          padding-left: 18px;
          border-left: 2px solid rgba(129,140,248,.32);
          display: grid;
          gap: 14px;
        }
        .preview-button {
          background: linear-gradient(135deg, #10b981, #06b6d4);
          color: #ffffff;
          padding: 12px 16px;
          border-radius: 16px;
          font-weight: 800;
          box-shadow: 0 14px 26px rgba(16,185,129,.22);
        }
        .fill-submit-button {
          background: linear-gradient(135deg, #8b5cf6, #ec4899);
          color: white;
          padding: 13px 18px;
          border-radius: 16px;
          font-weight: 800;
          box-shadow: 0 14px 30px rgba(139,92,246,.25);
        }
        .preview-box {
          margin-top: 18px;
          border-radius: 22px;
          background: rgba(2,6,23,.48);
          border: 1px solid rgba(148,163,184,.14);
          padding: 16px;
          color: #dbeafe;
          overflow: hidden;
        }
        .empty-state {
          color: #94a3b8;
          padding: 8px 0;
        }
        .preview-tree {
          display: grid;
          gap: 12px;
        }
        .preview-node {
          border-radius: 18px;
          background: rgba(255,255,255,.04);
          border: 1px solid rgba(255,255,255,.08);
          padding: 14px;
        }
        .preview-title, .fill-title {
          font-weight: 800;
          color: #f8fafc;
          line-height: 1.5;
        }
        .preview-meta {
          margin-top: 6px;
          color: #94a3b8;
          font-size: 13px;
        }
        .preview-child-wrap {
          margin-top: 12px;
          padding-left: 14px;
          border-left: 2px solid rgba(148,163,184,.22);
        }
        .submit-actions {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          margin-top: 18px;
        }
        .floating-actions {
          position: fixed;
          right: 24px;
          bottom: 24px;
          z-index: 100;
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
        .fill-card {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 14px;
          align-items: start;
          border-radius: 24px;
          border: 1px solid rgba(255,255,255,.10);
          background: linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.03));
          padding: 18px;
          position: relative;
        }
        .fill-card::before {
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 4px;
          background: linear-gradient(180deg, #6366f1, #22c55e);
          opacity: .85;
          border-top-left-radius: 24px;
          border-bottom-left-radius: 24px;
        }
        .fill-number {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 56px;
          height: 42px;
          padding: 0 14px;
          border-radius: 14px;
          background: linear-gradient(135deg, #6366f1, #818cf8);
          color: white;
          font-weight: 800;
          box-shadow: 0 10px 22px rgba(99,102,241,.25);
        }
        .fill-main {
          min-width: 0;
        }
        .fill-input, .fill-select {
          margin-top: 12px;
        }
        .fill-form-actions {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          margin-top: 18px;
        }
        .mini-note {
          font-size: 13px;
          color: #94a3b8;
          line-height: 1.6;
        }
        .shared-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 16px;
          padding: 8px 14px;
          border-radius: 999px;
          background: rgba(16,185,129,.12);
          border: 1px solid rgba(16,185,129,.25);
          color: #86efac;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: .08em;
          text-transform: uppercase;
        }
        @media (max-width: 980px) {
          .layout { grid-template-columns: 1fr; }
        }
        @media (max-width: 720px) {
          .hero, .panel-body, .panel-head { padding-left: 16px; padding-right: 16px; }
          .question-top { grid-template-columns: 1fr; }
          .question-controls { grid-template-columns: 1fr; }
          .move-group { width: 100%; }
          .ghost-button { flex: 1; }
          .floating-actions {
            left: 16px;
            right: 16px;
            bottom: 16px;
          }
          .floating-actions button {
            flex: 1;
          }
          .fill-card {
            grid-template-columns: 1fr;
          }
          .share-row {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <div className="container">
        <div className="hero">
          {isSharedSession && <div className="shared-badge">Shared Fill Link</div>}

          {!isSharedSession && (
            <div className="hero-top-row">
              <div className="mode-switch">
                <button
                  type="button"
                  className={`mode-button ${mode === "builder" ? "active" : ""}`}
                  onClick={() => setMode("builder")}
                >
                  Builder
                </button>
                <button
                  type="button"
                  className={`mode-button ${mode === "fill" ? "active" : ""}`}
                  onClick={handleOpenFillMode}
                >
                  Fill Form
                </button>
              </div>
            </div>
          )}

          <h1>Modern Nested Form</h1>
          <p>
            Build parent and child questions in one mode, then switch to fill mode and share the same form with a
            link.
          </p>

          {mode === "builder" ? (
            <>
              <div className="toolbar">
                <button type="button" className="primary-button" onClick={handleAddParent}>
                  + New Parent Question
                </button>
                <button type="button" className="reset-button" onClick={handleReset}>
                  Reset Form
                </button>
                <button type="button" className="share-button" onClick={handleCreateShareLink}>
                  Create Share Link
                </button>
              </div>

              {shareLink && (
                <div className="share-box">
                  <div className="share-row">
                    <input className="share-input" readOnly value={shareLink} />
                    <button type="button" className="share-button" onClick={handleCopyShareLink}>
                      Copy Link
                    </button>
                  </div>
                  <div className="share-status">{shareStatus || "Share this link with the person who should fill the form."}</div>
                </div>
              )}
            </>
          ) : (
            <div className="toolbar">
              <button type="button" className="fill-submit-button" onClick={handleSubmitFill}>
                Submit Filled Form
              </button>
              {!isSharedSession && (
                <button type="button" className="reset-button" onClick={handleBackToBuilder}>
                  Back to Builder
                </button>
              )}
              <button
                type="button"
                className="reset-button"
                onClick={() => {
                  setAnswers({});
                  setSubmitted(null);
                  setSubmitStatus("");
                }}
              >
                Clear Answers
              </button>
            </div>
          )}
        </div>

        {mode === "builder" ? (
          <div className="layout">
            <section className="panel">
              <div className="panel-head">
                <h2>Questions Builder</h2>
                <div className="counter">{numberedQuestions.length} top-level question(s)</div>
              </div>
              <div className="panel-body">
                <div className="card-stack">
                  {numberedQuestions.map((q, idx) => (
                    <QuestionCard
                      key={q.id}
                      question={q}
                      path={[idx]}
                      onUpdate={handleUpdate}
                      onDelete={handleDelete}
                      onAddChild={handleAddChild}
                      onMoveUp={(path) => handleMove(path, "up")}
                      onMoveDown={(path) => handleMove(path, "down")}
                      canMoveUp={idx > 0}
                      canMoveDown={idx < numberedQuestions.length - 1}
                      registerRef={registerRef}
                    />
                  ))}
                </div>

                <div className="submit-actions">
                  <button type="button" className="preview-button" onClick={handlePreview}>
                    Generate JSON Preview
                  </button>
                </div>
              </div>
            </section>

            <aside className="panel">
              <div className="panel-head">
                <h2>Review Hierarchy</h2>
                <div className="counter">Live preview</div>
              </div>
              <div className="panel-body">
                <div className="preview-box">
                  {preview ? (
                    <PreviewTree questions={preview} />
                  ) : (
                    <div className="empty-state">Submit to see the structure...</div>
                  )}
                </div>
              </div>
            </aside>
          </div>
        ) : (
          <div className="layout">
            <section className="panel">
              <div className="panel-head">
                <h2>Fill the Form</h2>
                <div className="counter">{numberedQuestions.length} top-level question(s)</div>
              </div>
              <div className="panel-body">
                <form onSubmit={handleSubmitFill}>
                  <div className="card-stack">
                    {numberedQuestions.map((q) => (
                      <FillQuestion
                        key={q.id}
                        question={q}
                        answers={answers}
                        setAnswers={setAnswers}
                      />
                    ))}
                  </div>

                  <div className="fill-form-actions">
                    <button type="submit" className="fill-submit-button">
                      Submit Filled Form
                    </button>
                    <button
                      type="button"
                      className="reset-button"
                      onClick={() => {
                        setAnswers({});
                        setSubmitted(null);
                        setSubmitStatus("");
                      }}
                    >
                      Clear Answers
                    </button>
                  </div>
                </form>
              </div>
            </section>

            <aside className="panel">
              <div className="panel-head">
                <h2>Submitted Response</h2>
                <div className="counter">Preview</div>
              </div>
              <div className="panel-body">
                <div className="preview-box">
                  {submitStatus && (
                    <div
                      style={{
                        marginBottom: "12px",
                        padding: "12px 14px",
                        borderRadius: "14px",
                        border: "1px solid rgba(34,197,94,.30)",
                        background: "rgba(34,197,94,.10)",
                        color: "#86efac",
                        fontWeight: 800,
                      }}
                    >
                      {submitStatus}
                    </div>
                  )}

                  {submitted ? (
                    <SubmittedTree questions={submitted} />
                  ) : (
                    <div className="empty-state">
                      Fill mode me form submit karne ke baad yahan response dikh jayega.
                    </div>
                  )}
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>

      {mode === "builder" && !isSharedSession && (
        <div className="floating-actions">
          <button type="button" className="primary-button" onClick={handleAddParent}>
            + New Parent Question
          </button>
          <button type="button" className="preview-button" onClick={handlePreview}>
            Generate JSON Preview
          </button>
        </div>
      )}
    </div>
  );
}