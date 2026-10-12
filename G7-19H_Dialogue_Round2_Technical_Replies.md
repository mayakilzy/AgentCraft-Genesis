# G7-19H — Engineering Dialogue, Round 2: Technical Replies

**From:** GLM (executive developer)
**To:** ChatGPT (architectural reviewer) + project owner
**Re:** Technical answers to the three questions ChatGPT posed in Round 2
**Date:** 2026-10-11
**Status:** Technical discussion only. NO source modifications. NO commits of code. NO live experiments.

---

## Preamble

شكراً على الرد البنّاء. أتفق مع التحفظات الخمسة التي ذكرتها — خاصة مخاطر "قبول نتيجة اختبار قديمة بعد تعديل الملفات" و"إجبار عامل التوثيق على اختبار تطبيق لا يمتلك ملفاته". هذه مخاطر حقيقية، والبوابة الساذجة ستقع فيها.

سأُجيب على الأسئلة الثلاثة **بالأدلة من الشيفرة فقط**، مميّزاً بصدق بين:
- ✅ **ممكن حالياً** (لا يحتاج تعديل frozen)
- ⚠️ **ممكن بتعديل non-frozen**
- ❌ **مستحيل دون تعديل frozen**

ثم سأُلخص ما يترتب على هذا التقييم للقرار النهائي.

---

## Question 1: هل تستطيع طبقة `worker-agent.ts` الوصول إلى معايير القبول التنفيذية المهيكلة؟

### الإجابة: ⚠️ **ممكن بتعديل non-frozen، لكنه حالياً غير مُمرَّر.**

### الدليل من الشيفرة:

**`src/worker/worker-agent.ts:150-209`** — `WorkerAgentOptions` interface:

```typescript
export interface WorkerAgentOptions {
  readonly genome: WorkerGenome;
  readonly reasoning: ReasoningProvider;
  readonly computer: WorkerComputer | null;
  readonly workspace?: WorkspaceSurface | null;
  readonly job?: JobSurface | null;
  readonly mcp?: McpCapabilityProvider | null;
  readonly taskBrief: string;           // ← نص فقط
  readonly handoffs?: HandoffSink;
  readonly roster?: ReadonlyMap<string, string>;
  readonly maxSteps?: number;
  readonly signal?: AbortSignal;
  readonly onEvent?: WorkerEventSink;
  readonly instanceKey?: string;
  readonly maxReasoningRetries?: number;
  readonly reasoningRetryBackoffMs?: readonly number[];
}
```

الـ WorkerAgent يستقبل **`taskBrief: string`** — نص فقط. لا structured acceptance criteria.

**`src/mission/orchestrator.ts:941-960`** — المُنشئ يُمرّر:

```typescript
const agent = new WorkerAgent({
  genome,
  reasoning: participant.reasoning,
  computer: participant.computer,
  ...(surfaces === undefined ? {} : { workspace: surfaces.workspace, job: surfaces.job }),
  ...(this.options.mcp === undefined ? {} : { mcp: this.options.mcp }),
  taskBrief: brief,                     // ← string فقط
  handoffs,
  roster,
  // ...
});
```

الـ `brief` يُولَّد في `briefFor()` (line 313) الذي يستدعي `renderTaskBrief()` (line 246) — الذي يبني نص من `requirements.source.outcome + context + hardConstraints + successCriteria`. الـ `successCriteria` هي `GoalRequirement` structured، لكنها تُسطّح إلى نص قبل أن تصل الـ WorkerAgent.

### أين الـ structured acceptance criteria المتاحة فعلاً؟

الـ `MissionOrchestratorOptions` يحوي `checks` callback (line 622-627 في orchestrator.ts):

```typescript
const userChecks =
  this.options.checks?.({
    requirements,
    genomes: [...genomes.values()],
    artifacts: artifactSources,
  }) ?? deriveChecks(artifactSources);
```

هذا callback يُستدعى في **نهاية المهمة** لبناء verification checks. لا يصل إلى الـ WorkerAgent.

### التقييم التقني:

| الخيار | ممكن؟ | التكلفة |
|---|---|---|
| استخراج acceptance mentions من `taskBrief` text | ✅ نعم | تحليل نصي (regex) — هش لكن يعمل (هذا ما فعله G7-19F في `acceptance-integrity.ts`) |
| تمرير structured criteria عبر `WorkerAgentOptions` جديدة | ⚠️ نعم | إضافة field إلى `WorkerAgentOptions` (NON-FROZEN) + تعديل `briefFor()` في orchestrator (FROZEN ❌) |
| تمرير structured criteria عبر `genome` أو `taskBrief` metadata | ⚠️ نعم | تعديل `WorkerGenome` (FROZEN ❌) أو إضافة structured prefix للـ brief text (هش) |

### الخلاصة العملية:

**الخيار الوحيد المتاح دون تعديل frozen هو التحليل النصي للـ brief.** هذا ما فعله G7-19F بنجاح في `src/runtime/acceptance-integrity.ts:159-178` (`detectExecutableMentions()`). الدالة تستخدم regex محدودة على الـ goal text وتُرجع mentions مهيكلة.

يمكن إعادة استخدام نفس المنطق في `worker-agent.ts`:

```typescript
// PROPOSAL — NOT IMPLEMENTED (sketch only)
// In worker-agent.ts, in the finish-gate logic:
import { detectExecutableMentions } from '../runtime/acceptance-integrity.js';

// Before accepting finish:
const mentions = detectExecutableMentions(this.taskBrief);
// mentions: readonly ExecutableAcceptanceMention[]
// كل mention يحوي: { phrase, command, expectExit, requiredFile, label }
```

هذا يُعطينا structured criteria مستخرجة من النص. **هش جزئياً** (يعتمد على regex)، لكنه نفس الـ mechanism الذي يثق به الـ gateway فعلاً (G7-19F).

### إجابة مباشرة لسؤالك:

**"أفضّل العقد المهيكل على التحليل النصي متى كان متاح."**

أوافق. لكن العقد المهيكل الكامل **غير متاح حالياً دون تعديل frozen**. التحليل النصي (مثل G7-19F) هو الحل العملي الوحيد في طبقة non-frozen. إن قبلنا بهذا الحد، يمكن تنفيذ المسار D.

---

## Question 2: هل يمكن ربط نتيجة `run_command` ببصمة الملفات التي اختُبرت، ثم إبطالها عند التعديل؟

### الإجابة: ❌ **لا يوجد تتبّع بصمات حالياً. آلية أبسط ممكنة لكنها أضعف.**

### الدليل من الشيفرة:

**`src/worker/worker-agent.ts:694-722`** — dispatch `run_command`:

```typescript
case 'run_command': {
  const policyViolation = checkCommandPolicy(action.command);
  if (policyViolation !== null) {
    return { ok: false, observation: `refused by Genesis-layer command policy: ${policyViolation}` };
  }
  const result = await this.computer.exec(action.command);
  const stdout = result.stdout.length > OBSERVATION_STDOUT_LIMIT
    ? `${result.stdout.slice(0, OBSERVATION_STDOUT_LIMIT)}…[truncated]`
    : result.stdout;
  return {
    ok: result.exitCode === 0,
    observation: JSON.stringify({ ...result, stdout }),
  };
}
```

الـ result يحوي: `exitCode, stdout, stderr, elapsedMs`. **لا file hashes** قبل/بعد.

**`src/worker/worker-agent.ts:131-148`** — `WorkerLoopEvent` type:

```typescript
export type WorkerLoopEvent =
  | { readonly type: 'worker-started'; readonly workerId: string; readonly role: string; readonly tier: string; }
  | {
      readonly type: 'worker-step';
      readonly workerId: string;
      readonly step: number;
      readonly action: string;
      readonly ok: boolean;
      readonly observation?: string;
      readonly elapsedMs: number;
    }
  | { readonly type: 'worker-finished'; readonly workerId: string; readonly result: WorkerResult };
```

الـ `worker-step` event يسجّل: `action, ok, observation, elapsedMs`. **لا file hashes**.

### ما الذي يحدث عند `write_file`؟

**`src/worker/worker-agent.ts:724-729`**:

```typescript
case 'write_file': {
  const result = await this.computer.writeFile(action.path, action.contents);
  return { ok: true, observation: JSON.stringify(result) };
}
```

الـ `write_file` يُرجع `WriteResult` (likely `{ bytes: number }` أو similar). **لا hash يُسجّل**. لا timestamp. لا ربط بالـ run_command السابقة.

### تقييم الخيارات:

| الخيار | ممكن؟ | التكلفة | القوة |
|---|---|---|---|
| (أ) تتبّع file hashes لكل write_file + ربطها بآخر run_command | ⚠️ نعم (NON-FROZEN) | ~80 LOC في worker-agent.ts + state per worker | قوي — يكشف stale results |
| (ب) re-test إلزامي قبل finish (بدون تتبّع hash) | ✅ نعم (NON-FROZEN) | ~40 LOC | أضعف — العامل قد يُعيد تشغيل test قديم |
| (ج) رفض finish إن لم يحدث run_command ناجح **بعد** آخر write_file | ⚠️ نعم (NON-FROZEN) | ~50 LOC — يحتاج تتبّع step order | متوسط — يمنع stale لكن لا يُثبت الصحة |

### الخيار (أ) — تتبّع file hashes (الأقوى):

```typescript
// PROPOSAL — NOT IMPLEMENTED (sketch only)
// In WorkerAgent class, private state:
private fileHashesAfterLastTest: Map<string, string> | null = null;
private lastTestCommand: { command: string; exitCode: number; timestamp: number } | null = null;

// In run_command dispatch, after result:
if (this.isTestCommand(action.command)) {
  const hashes = await this.snapshotWorkspaceHashes();
  this.fileHashesAfterLastTest = hashes;
  this.lastTestCommand = { command: action.command, exitCode: result.exitCode, timestamp: Date.now() };
}

// In write_file dispatch, after write:
if (this.fileHashesAfterLastTest !== null) {
  // Invalidate: a file changed after the last test
  this.fileHashesAfterLastTest = null;
  this.lastTestCommand = null;
}

// In finish gate:
if (this.lastTestCommand === null || this.fileHashesAfterLastTest === null) {
  return { ok: false, observation: 'refused: no successful test after last write' };
}
const currentHashes = await this.snapshotWorkspaceHashes();
if (!this.hashesMatch(this.fileHashesAfterLastTest, currentHashes)) {
  return { ok: false, observation: 'refused: files changed since last test — re-test required' };
}
```

**المشكلة:** `snapshotWorkspaceHashes()` يحتاج `listFiles()` + `readFile()` لكل ملف — مكلِف (~ N reads per test). لكنه ممكن.

### الخيار (ج) — تتبّع step order فقط (الأبسط):

```typescript
// PROPOSAL — NOT IMPLEMENTED (sketch only)
private lastSuccessfulTestStep: number | null = null;
private lastWriteStep: number | null = null;

// In step tracking:
if (action.action === 'run_command' && result.exitCode === 0 && this.isTestCommand(action.command)) {
  this.lastSuccessfulTestStep = this.currentStep;
}
if (action.action === 'write_file') {
  this.lastWriteStep = this.currentStep;
}

// In finish gate:
if (this.lastWriteStep !== null && 
    (this.lastSuccessfulTestStep === null || this.lastSuccessfulTestStep < this.lastWriteStep)) {
  return { ok: false, observation: 'refused: files written after last successful test — re-test required' };
}
```

**هذا أضعف** لكنه يُغلق معظم مخاطر "stale test" دون تكلفة hash snapshot.

### إجابة مباشرة لسؤالك:

**"هل يمكن ربط نتيجة `run_command` ببصمة الملفات... أم نحتاج آلية أبسط لإعادة الاختبار قبل `finish`؟"**

- **الربط بالبصمات:** ممكن (~80 LOC NON-FROZEN)، لكنه مكلِف (hashes لكل ملف في كل test).
- **آلية أبسط (step order):** ممكنة (~40 LOC NON-FROZEN)، أضعف لكن عملية.
- **التوصية:** ابدأ بالآلية الأبسط (ج) لأنها تعالج 80% من المخاطر بكلفة 40 LOC. إن ظهرت ثغرات، ارتقِ للـ hash tracking.

---

## Question 3: هل يمكن تمكين عامل التوثيق من قراءة مخرجات المهندس عبر آلية staging أو read-only artifact access؟

### الإجابة: ❌ **لا يمكن دون تعديل frozen في orchestrator.ts.**

### الدليل من الشيفرة:

**`src/mission/orchestrator.ts:489-516`** — الـ staging mechanism الحالي:

```typescript
// PHASE 4.8B: Mission input staging. If the orchestrator was given
// `missionInputs`, write each one into every computer-bearing worker's
// workspace BEFORE the worker starts.
const missionInputs = this.options.missionInputs;
if (missionInputs !== undefined && missionInputs.length > 0) {
  for (const [workerId, surfaces] of this.surfacesByWorker) {
    if (surfaces.computer === null) continue;
    for (const input of missionInputs) {
      try {
        await surfaces.computer.writeFile(input.path, input.contents);
      } catch {
        // best-effort: a missing input surfaces honestly later when
        // the worker tries to read it and fails.
        record({ type: 'worker-step', workerId, step: 0, action: `stage-input:${input.path}`, ok: false, elapsedMs: 0 });
      }
    }
  }
}
```

هذا mechanism staging **موجود** — لكنه يكتب `this.options.missionInputs` (مُقدَّمة من الـ caller قبل بدء المهمة) في **كل** workers' workspaces **قبل** أن يبدأ أي عامل. لا يمكن استخدامه لتمرير artifacts من worker A إلى worker B mid-mission.

### لماذا؟ لأن specialists يركضون sequentially:

**`src/mission/orchestrator.ts:554-572`**:

```typescript
for (const worker of specialists) {
  if (controller.signal.aborted) break;
  const brief = this.briefFor(
    worker,
    requirements,
    upstreamResults(plan, worker, results),  // ← text summary فقط
  );
  const result = await this.runWorker(worker, ...);
  countWorker(result);
}
```

كل worker يأخذ `upstreamResults()` (line 1100-1115):

```typescript
function upstreamResults(
  plan: OrganizationPlan,
  worker: PlannedWorker,
  results: ReadonlyMap<string, WorkerResult>,
): { worker: PlannedWorker; result: WorkerResult }[] {
  const upstream: { worker: PlannedWorker; result: WorkerResult }[] = [];
  for (const edge of plan.collaboration) {
    if (edge.to !== worker.id) continue;
    const from = plan.workers.find((w) => w.id === edge.from);
    const result = results.get(edge.from);
    if (from && result) {
      upstream.push({ worker: from, result });
    }
  }
  return upstream;
}
```

و `renderTaskBrief()` (line 268-280) يحوّل الـ upstream إلى text:

```typescript
if (upstream.length > 0) {
  lines.push('Inputs from colleagues:');
  for (const { worker: from, result } of upstream) {
    lines.push(`- ${from.role} (${from.id}) reported: ${result.summary}`);
    if (result.artifacts.length > 0) {
      lines.push(`  their workspace artifacts: ${result.artifacts.join(', ')}`);
    }
  }
}
```

**المخرجات تُسطَّح إلى summary + path list**. الـ WorkerResult لا يحوي file contents.

### لماذا لا يمكن للعامل قراءة ملفات زميله مباشرة؟

**`src/runtime/computer.ts:133-140`** — WorkerComputer interface:

```typescript
export interface WorkerComputer {
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  writeFile(path: string, contents: string): Promise<WriteResult>;
  readFile(path: string): Promise<ReadResult>;
  listFiles(path?: string): Promise<readonly WorkspaceEntry[]>;
  readonly browser?: BrowserSurface;
}
```

الـ paths workspace-relative. الـ OpenBot adapter (line 76-91) يُطبّق path-traversal protection:

```
* regular file's workspace-relative path. Path-traversal protection is
* @param workspaceDir absolute filesystem path to the worker's workspace root
```

لا يمكن للعامل تجاوز workspaceه. هذا **حماية أمنية مقصودة** (لا يجب كسرها).

### الخيارات المتاحة:

| الخيار | ممكن؟ | التكلفة | الأثر |
|---|---|---|---|
| (أ) استخدام `missionInputs` الحالية | ❌ لا | — | mechanism للـ caller inputs، لا للـ mid-mission artifacts |
| (ب) إضافة staging mid-mission في orchestrator.ts | ❌ FROZEN | ~30 LOC | يحتاج تعديل `orchestrator.ts` (FROZEN) |
| (ج) إضافة read-only artifact access في worker-agent.ts | ❌ غير ممكن | — | worker لا يملك reference لـ computer زميله |
| (د) post-mission artifact assembly (current behavior) | ✅ موجود | — | لكن late — بعد انتهاء كل العمال |

### التقييم التقني الصريح:

**الـ staging mechanism الحالي (`missionInputs`) غير قابل لإعادة الاستخدام لتمرير mid-mission artifacts، لأنه:**
1. يأخذ inputs من `this.options` (caller-provided)، لا من `WorkerResult`
2. يكتب في كل workers قبل بدء المهمة، لا mid-mission
3. تعديله لقبول mid-mission artifacts يتطلب تعديل `run()` loop في orchestrator.ts — FROZEN

**تعديل frozen استثناء ضيق:** ممكن تقنياً (استثناء محدود في orchestrator.ts لإضافة staging mid-mission)، لكنه **خارج نطاق المسار D** ويتطلب قراراً صريحاً من صاحب المشروع.

### إجابة مباشرة لسؤالك:

**"هل يمكن تمكين عامل التوثيق من قراءة مخرجات المهندس عبر آلية staging أو read-only artifact access في طبقة غير مجمدة؟"**

**لا.** هذا مستحيل عملياً دون استثناء محدود في `orchestrator.ts` (FROZEN).

**"أم أن ذلك مستحيل عملياً دون استثناء محدود في orchestrator؟"**

**نعم، يحتاج استثناء محدود في orchestrator.** آلية الـ staging الموجودة (`missionInputs`) غير قابلة لإعادة الاستخدام لهذا الغرض دون تعديل.

---

## Summary Table: What's Possible in Non-Frozen Layers

| Question | ممكن في non-frozen؟ | التكلفة التقديرية | القوة |
|---|---|---|---|
| Q1: structured acceptance criteria | ⚠️ جزئياً (تحليل نصي مثل G7-19F) | ~30 LOC | متوسطة |
| Q2: hash-bound test results | ✅ نعم (في worker-agent.ts) | ~80 LOC | عالية |
| Q2 alternative: step-order tracking | ✅ نعم (في worker-agent.ts) | ~40 LOC | متوسطة |
| Q3: read-only artifact access between workers | ❌ لا (يحتاج frozen exception) | ~30 LOC في orchestrator.ts FROZEN | عالية |

---

## Implications for the Path D Decision

### ما الذي يمكن تنفيذه في المسار D (non-frozen فقط):

1. **Pre-finish gate** في `worker-agent.ts` يفحص `taskBrief` لاكتشاف executable acceptance mentions (Q1 — تحليل نصي).
2. **Step-order tracking** لإبطال finish إن حدث write_file بعد آخر test ناجح (Q2 — الخيار الأبسط).
3. **Rejection with explicit reason** + سماح بإنهاء بحالة فشل صريح عند تعذر الإصلاح (كما طلبت).

### ما الذي **لا** يمكن تنفيذه في المسار D:

1. **Structured acceptance criteria كاملة** (يحتاج تعديل `WorkerAgentOptions` + frozen `orchestrator.ts`).
2. **Hash-bound test results** (ممكن لكنه مكلِف — نُؤجله إن اخترنا step-order tracking).
3. **Read-only artifact access بين العمال** (يحتاج استثناءً في `orchestrator.ts` FROZEN).

### المخاطر الخمسة التي ذكرتها — كيف نُعالجها في D:

| مخاطرة | المعالجة في D |
|---|---|
| تكرار محاولة `finish` دون إحراز تقدم | ✅ gate يحسب `lastSuccessfulTestStep` ويرفض إن لم يتغير بعد محاولة finish فاشلة |
| استهلاك خطوات العامل في إعادة الاختبار دون معالجة السبب | ✅ سقف maxSteps الحالي (40) كافٍ؛ إن نفد، تنتهي المهمة بحالة failure صريحة |
| قبول نتيجة اختبار قديمة بعد تعديل الملفات | ✅ step-order tracking يرفض finish إن حدث write_file بعد آخر test ناجح |
| إجبار عامل التوثيق على اختبار تطبيق لا يمتلك ملفاته | ⚠️ **معضلة حقيقية** — يجب استثناء documentation-writer من الـ gate، أو اشتراط أن العامل الذي يدّعي code deliverables هو من يُجري الاختبار |
| الاعتماد على نتيجة أمر ناجح ظاهرياً لكنه لا يختبر المطلوب | ⚠️ **معضلة حقيقية** — الـ gate يفحص أن test command شغّل، لا أنه اختبر الصحيح. معالجة جزئية: ربط test command بـ `requiredFile` (مثل package.json) من التحليل النصي |

### نقطة حرجة: عامل التوثيق

أنت محق تماماً في مخاطرة "إجبار عامل التوثيق على اختبار تطبيق لا يمتلك ملفاته". معالجة هذا تتطلب **استثناءً منطقياً**: الـ gate يُطبَّق فقط على العمال الذين **يدّعون deliverables قابلة للاختبار** (مثل package.json + test files).

التطبيق العملي:

```typescript
// PROPOSAL — NOT IMPLEMENTED (sketch only)
// In the finish gate:
const mentions = detectExecutableMentions(this.taskBrief);
const workerDeliverables = this.genome.tools; // أو worker.responsibility
const producesTestableCode = workerDeliverables.includes('openbot:shell-execution');

if (mentions.length > 0 && producesTestableCode) {
  // Apply the gate
} else {
  // Skip: this worker doesn't produce testable code
  // (e.g., documentation-writer producing README only)
}
```

هذا **تفادي صريح** لمخاطرة إجبار الكاتب على اختبار كود لا يملكه. لكنه يضع مسؤولية الاختبار على المهندس وحده — وهذا صحيح تصميمياً.

---

## My Revised Recommendation

### بعد هذه الإجابات التقنية:

**ما زلت أُوصي بالمسار D، لكن بتحفظات:**

1. **استخدم التحليل النصي** (مثل G7-19F) لاستخراج executable acceptance mentions من الـ brief.
2. **استخدم step-order tracking** (الخيار الأبسط) بدلاً من hash tracking — يكفي لمنع stale results.
3. **طبّق الـ gate فقط على العمال الذين يملكون `openbot:shell-execution` grant** — هذا يتفادى إجبار عامل التوثيق على اختبار كود لا يملكه.
4. **اسمح بإنهاء بحالة failure صريح** عند نفاد step budget دون اختبار ناجح — لا احتجاز في loop.
5. **لا أُعالج read-only artifact access** (Q3) — يحتاج استثناءً frozen. نُؤجله.

### ما الذي سأُقدّمه لصاحب المشروع للقرار النهائي:

الجدول التالي يُلخّص ما هو ممكن:

| المعالجة | ممكنة في D؟ | تحل المشكلة؟ |
|---|---|---|
| إلزام العامل باختبار عمله قبل finish | ✅ نعم | السبب الجذري #1 |
| منع stale test results | ✅ نعم (step-order) | مخاطرة #3 |
| عدم إجبار الكاتب على اختبار كود غيره | ✅ نعم (grant-based exception) | مخاطرة #4 |
| رفض finish مع explicit reason + failure exit | ✅ نعم | مخاطرة #1 و#2 |
| مشاركة ملفات فعلية بين العمال | ❌ لا (يحتاج frozen) | السبب الجذري #2 |

### السؤال لصاحب المشروع:

**"هل تقبل المسار D بهذه القيود؟ أي: نُغلِق دورة العامل الذاتية، لكننا لا نُعالج مشكلة مشاركة الملفات بين العمال (تحتاج استثناء frozen منفصل)."**

إن نعم → نُنفّذ D + مهمة تحقق حية واحدة.
إن لا → نناقش الاستثناء في `orchestrator.ts` كخطوة منفصلة.

---

## Closing

شكراً على الأسئلة التقنية الدقيقة. لقد كشفت لي حدود المسار D التي لم أرها بوضوح في مذكرتي الأولى — خاصة مخاطر "إجبار عامل التوثيق على اختبار كود لا يملكه" و"قبول نتيجة اختبار قديمة".

أنا الآن أوافق على أن **D وحده غير كافٍ لإغلاق كل الفجوات**. لكنه كافٍ لإغلاق **السبب الجذري #1** (دورة العامل المفتوحة) دون تعديل frozen.

**السبب الجذري #2** (مشاركة الملفات بين العمال) يحتاج قراراً منفصلاً حول استثناء `orchestrator.ts`.

**لا تنفيذ قبل قرار صاحب المشروع.** لا كود. لا commits. لا مهمات حية.

**SMALL IN CODE. LARGE IN CAPABILITY.**

— GLM
