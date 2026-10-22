/**
 * THE PLAN REVIEW PANEL (ARCHITECTURE_SPEC.md §14.1, §13.3, §14.4, §24.9, §26 Phase 18).
 *
 * It is the review gate. A plan — pasted as JSON in Phase 18 (the AI layer that can
 * *generate* one is Phase 19, §24.10) — is validated, previewed beside the current scene,
 * edited, re-previewed, and only then applied, as a single commit that undoes in a single
 * step. Until the Apply button is pressed, **nothing in the document changes**:
 * `reviewPlan` is pure, `planStore` holds only the plan, and `dispatch({ plan })` is the one
 * place a plan can touch the project (§14.1 step 6).
 *
 * Four of the brief's "human review" requirements land here and are worth naming:
 *
 *  - **Errors block, warnings do not** (§14.1 step 2). Apply is disabled on any `error`
 *    diagnostic (`blocksApply`); a warning is shown and does not refuse.
 *  - **Never apply on `ok` alone** (§14.4): a plan that stages a character facing the wall
 *    validates perfectly, so the three stills and the diff are the review, not the absence
 *    of red text.
 *  - **Editing the plan costs no undo step** (§13.4). The panel re-validates and re-previews
 *    from the live project on every render; only Apply commits.
 *  - **Provenance is honest** (§14.3): an untouched AI plan applies as `ai`; a plan a human
 *    edited in the panel applies as `human`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, useOpenContext, useOpenProject, useOpenSeries } from '../../state/editorStore';
import { usePlan } from '../../state/planStore';
import { inputClass } from '../draftFields';
import { fixedClock, makeCountingAllocator } from '../../core/plans/allocator';
import { editedFieldPaths } from '../../core/plans/edits';
import { parsePlan, parseScenePlan } from '../../core/plans/parse';
import { blocksApply, previewSceneId, reviewPlan } from '../../core/plans/review';
import type { PlanReview } from '../../core/plans/review';
import type { ScenePlan } from '../../core/plans/types';
import { resolveAssets } from '../../core/document/scopes';
import { renderScene } from '../../core/render/render';
import type { Scene, SceneContext } from '../../core/types';
import { PlanEditor } from './PlanEditor';
import { PlanGeneratePanel } from './PlanGeneratePanel';

const STILL_WIDTH = 84;
/** The three moments that catch a plan's failure modes: staging, timing and framing (§13.3). */
const STILL_FRACTIONS = [0.1, 0.5, 0.9] as const;

function severityClass(severity: string): string {
  if (severity === 'error') return 'border-red-900/60 bg-red-950/40 text-red-400';
  if (severity === 'warning') return 'border-amber-900/60 bg-amber-950/40 text-amber-400';
  return 'border-ink-800 text-ink-400';
}

function summarize(review: PlanReview): { scenes: number; actors: number; lines: number; assets: number } {
  if (!review.ok) return { scenes: 0, actors: 0, lines: 0, assets: 0 };
  return {
    scenes: review.diff.scenes.length,
    actors: review.diff.actors.length,
    lines: review.diff.lines.length,
    assets: review.diff.assets.length,
  };
}

function describeParseError(error: { code: string; message?: string }): string {
  return error.code === 'not-json' ? 'That is not valid JSON.' : (error.message ?? 'That is not a usable plan.');
}

/**
 * Three stills of the *previewed* document (§13.3), drawn by the same pure `renderScene` the
 * stage and the exporter use — because it takes any document, drawing the document a plan
 * *would* produce costs nothing beyond one extra draw per still.
 */
function StillPreview({ context, scene }: { context: SceneContext; scene: Scene }): React.JSX.Element {
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const height = Math.max(1, Math.round((STILL_WIDTH * context.settings.height) / context.settings.width));

  // Re-drawn whenever the reviewed document or its scene changes. The renderer is pure, so
  // there is no clock to keep ticking — a still is a single draw at a fixed time.
  useEffect(() => {
    for (const [index, fraction] of STILL_FRACTIONS.entries()) {
      const element = canvasRefs.current[index];
      if (!element) continue;
      const ctx = element.getContext('2d');
      if (!ctx) continue;
      element.width = STILL_WIDTH * dpr;
      element.height = height * dpr;
      element.style.width = `${STILL_WIDTH}px`;
      element.style.height = `${height}px`;
      renderScene(ctx, context, scene, scene.duration * fraction, {
        width: STILL_WIDTH,
        height,
        pixelRatio: dpr,
        subtitles: false,
      });
    }
  }, [context, scene, height, dpr]);

  return (
    <div className="grid grid-cols-3 gap-1">
      {STILL_FRACTIONS.map((fraction, index) => (
        <canvas
          key={fraction}
          ref={(element) => {
            canvasRefs.current[index] = element;
          }}
          aria-label={`Still at ${Math.round(fraction * 100)}%`}
          className="rounded border border-ink-800"
        />
      ))}
    </div>
  );
}

function DiffSection({ title, rows }: { title: string; rows: { kind: string; label: string }[] }): React.JSX.Element {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-ink-500">{title}</div>
      {rows.length === 0 ? (
        <div className="text-[10px] text-ink-500">Nothing.</div>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((row, index) => (
            <li key={`${row.kind}:${row.label}:${index}`} className="font-mono text-[10px] text-ink-300">
              <span className="text-ink-500">{row.kind}</span> {row.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The review history — proposals this workspace has seen (§9.5, Phase 18 step 7).
 *
 * It exists for the proposal that was closed without applying: reopening it costs nothing,
 * and re-authoring it costs a person's time. A title and an actor are the whole row, because
 * past the title there is nothing a person can decide from a list.
 */
function RecentPlans(): React.JSX.Element | null {
  const history = usePlan((s) => s.history);
  const openHistory = usePlan((s) => s.openHistory);
  const forgetHistory = usePlan((s) => s.forgetHistory);
  if (history.length === 0) return null;
  return (
    <div className="space-y-1 border-t border-ink-800 pt-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-500">Recent plans</div>
      <ul className="space-y-0.5">
        {history.map((entry) => (
          <li key={entry.id} className="flex items-center gap-1">
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left text-[10px] text-ink-300 hover:text-white"
              title={`${entry.actor} · ${entry.createdAt}`}
              onClick={() => {
                void openHistory(entry.id);
              }}
            >
              {entry.title}
            </button>
            <button
              type="button"
              aria-label={`Forget ${entry.title}`}
              className="shrink-0 text-[10px] text-ink-500 hover:text-red-300"
              onClick={() => {
                void forgetHistory(entry.id);
              }}
            >
              Forget
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PlanReviewPanel(): React.JSX.Element {
  const project = useOpenProject();
  const context = useOpenContext();
  const series = useOpenSeries();
  const dispatch = useEditor((s) => s.dispatch);

  const envelope = usePlan((s) => s.envelope);
  const original = usePlan((s) => s.original);
  const recordId = usePlan((s) => s.recordId);
  const load = usePlan((s) => s.load);
  const edit = usePlan((s) => s.edit);
  const reset = usePlan((s) => s.reset);
  const close = usePlan((s) => s.close);
  const persist = usePlan((s) => s.persist);
  const refreshHistory = usePlan((s) => s.refreshHistory);
  const forgetHistory = usePlan((s) => s.forgetHistory);

  // Read the history once, when the panel appears. It is a listing, not a subscription: a
  // proposal written by another tab is picked up on the next mount rather than watched for.
  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const [pasted, setPasted] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * The review, recomputed from the live project on every change to the plan or the document.
   *
   * The allocator and clock are fixed so the previewed document is stable across renders —
   * a fresh id on each keystroke would make the diff flicker and defeat the identity-based
   * memoisation the rest of the editor depends on.
   */
  const review: PlanReview | null = useMemo(() => {
    if (envelope === null) return null;
    return reviewPlan({ project, assets: context.assets, series }, envelope, {
      allocate: makeCountingAllocator(),
      now: fixedClock(envelope.createdAt),
    });
  }, [project, context, series, envelope]);

  /** Body paths a human changed since the plan arrived — the `Edited` badge source (§14.3). */
  const edited = useMemo(() => {
    if (envelope === null || original === null) return new Set<string>();
    const paths = new Set<string>(editedFieldPaths(original.body, envelope.body));
    if (original.title !== envelope.title) paths.add('title');
    return paths;
  }, [original, envelope]);

  /** The parsed plan body, for the editor form. `null` if it is not a usable scene plan. */
  const plan: ScenePlan | null = useMemo(() => {
    if (envelope === null) return null;
    const parsed = parseScenePlan(envelope.body);
    return parsed.ok ? parsed.value : null;
  }, [envelope]);

  if (envelope === null) {
    return (
      <section className="border-t border-ink-800 px-3 py-3 space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Plan review</h2>
        <p className="text-[10px] leading-snug text-ink-500">
          Paste a scene plan as JSON to preview and edit it before it touches the document. Nothing changes until you
          press Apply.
        </p>
        <textarea
          className={`${inputClass} h-20 font-mono`}
          aria-label="Paste a plan as JSON"
          value={pasted}
          onChange={(event) => {
            setPasted(event.target.value);
            setLoadError(null);
          }}
        />
        <button
          type="button"
          className="w-full rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-200 hover:border-zanza-500 hover:text-white disabled:opacity-40"
          disabled={pasted.trim() === ''}
          onClick={() => {
            const result = parsePlan(pasted);
            if (result.ok) {
              load(result.value);
              // Record the proposal the moment it is opened for review, so closing without
              // applying is recoverable. `load` sets the envelope synchronously, so `persist`
              // sees it.
              void persist();
              setPasted('');
              setLoadError(null);
            } else {
              setLoadError(describeParseError(result.error));
            }
          }}
        >
          Load plan
        </button>
        {loadError && (
          <div className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-[10px] text-red-300" role="status">
            {loadError}
          </div>
        )}
        {/* The AI generate affordance (Phase 19 step 5). It loads `src/ai` dynamically,
            so this panel still renders and still works with the AI layer deleted. With no
            provider configured it reports an honest reason and generates nothing. */}
        <PlanGeneratePanel
          onGenerated={(raw) => {
            const result = parsePlan(raw);
            if (result.ok) {
              load(result.value);
              void persist();
              setPasted('');
              setLoadError(null);
            } else {
              setLoadError(describeParseError(result.error));
            }
          }}
        />
        <RecentPlans />
      </section>
    );
  }

  const blocked = review !== null && blocksApply(review);
  const sceneId = review === null ? null : previewSceneId(review);
  const previewScene =
    review === null || !review.ok || sceneId === null
      ? null
      : (review.preview.scenes.find((candidate) => candidate.id === sceneId) ?? null);

  const apply = (): void => {
    if (review === null || blocked) return;
    // A human-edited plan is a human plan (§13.4, §14.3); an untouched one keeps the
    // provenance it arrived with.
    const provenance = edited.size > 0 ? ({ actor: 'human' as const, at: new Date().toISOString() }) : undefined;
    dispatch({ plan: envelope, ...(provenance ? { provenance } : {}) });
    // Applied, so the plan is discarded (§9.5) — only its `Provenance` survives, stamped onto
    // the history entry the commit produced. The row, if this proposal was ever recorded, goes
    // with it.
    if (recordId !== null) void forgetHistory(recordId);
    close();
  };

  const counts =
    review !== null && review.ok ? summarize(review) : { scenes: 0, actors: 0, lines: 0, assets: 0 };

  return (
    <section className="border-t border-ink-800 px-3 py-3 space-y-3">
      <div className="flex items-center">
        <h2 className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Plan review</h2>
        <span
          className={`rounded px-1.5 py-px font-mono text-[10px] uppercase ${
            envelope.provenance?.actor === 'ai' ? 'bg-ink-800 text-ink-200' : 'bg-ink-800 text-ink-400'
          }`}
          title={
            envelope.provenance
              ? `${envelope.provenance.actor}${envelope.provenance.provider ? ` · ${envelope.provenance.provider}` : ''}${
                  envelope.provenance.model ? ` · ${envelope.provenance.model}` : ''
                }`
              : 'Human-authored plan'
          }
        >
          {envelope.provenance?.actor === 'ai' ? 'AI' : 'Human'}
        </span>
      </div>
      <div className="font-mono text-[11px] text-ink-200">{envelope.title}</div>

      {review !== null && !review.ok && (
        <div className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-[10px] text-red-300" role="status">
          This plan cannot be applied yet. See the problems below.
        </div>
      )}

      {/* Validation report — errors block, warnings do not (§14.1 step 2). */}
      {review !== null && review.validation.diagnostics.length > 0 && (
        <ul className="space-y-1">
          {review.validation.diagnostics.map((diagnostic, index) => (
            <li
              key={`${diagnostic.path}:${diagnostic.code}:${index}`}
              className={`rounded border px-2 py-1 text-[10px] ${severityClass(diagnostic.severity)}`}
              title={diagnostic.hint}
            >
              <span className="font-mono">{diagnostic.path}</span> — {diagnostic.message}
            </li>
          ))}
        </ul>
      )}

      {/* The three stills of the previewed document (§13.3). */}
      {review !== null && review.ok && previewScene !== null && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-ink-500">Preview at 10% / 50% / 90%</div>
          <StillPreview context={resolveAssets(review.preview, series)} scene={previewScene} />
        </div>
      )}

      {/* What changes, and what it breaks (§14.4). */}
      {review !== null && review.ok && (
        <div className="space-y-2">
          <div className="text-[10px] text-ink-500">
            What changes: {counts.scenes} scene, {counts.actors} cast, {counts.lines} line, {counts.assets} asset.
          </div>
          <DiffSection
            title="Changes"
            rows={review.diff.scenes.map((row) => ({ kind: row.kind, label: row.label }))}
          />
          <DiffSection
            title="Breaks"
            rows={review.diff.issues.map((issue) => ({ kind: issue.severity, label: `${issue.path}: ${issue.message}` }))}
          />
        </div>
      )}

      {/* Assumptions the compiler made (§24.9 step 6). */}
      {review !== null && review.ok && review.assumptions.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-ink-500">Assumptions</div>
          <ul className="space-y-0.5">
            {review.assumptions.map((assumption, index) => (
              <li key={`${assumption.path}:${index}`} className="text-[10px] leading-snug text-ink-400">
                <span className="font-mono text-ink-500">{assumption.path}</span> {assumption.decision}
                <span className="block text-ink-500">{assumption.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The plan form. Editing re-previews and never commits (§13.4). */}
      {plan !== null && (
        <div className="space-y-1 border-t border-ink-800 pt-2">
          <div className="text-[10px] uppercase tracking-wider text-ink-500">Edit the plan</div>
          <PlanEditor
            plan={plan}
            title={envelope.title}
            edited={edited}
            onTitle={(title) => edit({ ...envelope, title })}
            onPlan={(next) => edit({ ...envelope, body: next })}
          />
        </div>
      )}

      {/* Apply is the only mutation; Reset and Close are free (§14.1 step 6). */}
      <div className="flex gap-1">
        <button
          type="button"
          disabled={blocked}
          onClick={apply}
          className="rounded border border-zanza-500 px-2 py-1 text-[11px] text-white hover:bg-zanza-500/10 disabled:opacity-40"
        >
          Apply plan
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-200 hover:border-zanza-500 hover:text-white"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={close}
          className="rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-300 hover:border-red-900 hover:bg-red-950/40 hover:text-red-300"
        >
          Close
        </button>
      </div>

      <RecentPlans />
    </section>
  );
}
