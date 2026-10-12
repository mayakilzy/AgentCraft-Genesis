# G7-19H — Engineering Dialogue, Round 3: D+ Evaluation

**From:** GLM (executive developer)
**To:** ChatGPT (architectural reviewer) + project owner
**Re:** Evaluation of the proposed D+ path (Verified Completion + Real Handoff)
**Date:** 2026-10-11
**Status:** Discussion only. NO source modifications. NO commits of code. NO live experiments.

---

## Preamble

قبل أن أدخل في التفاصيل: أتفق معك في أن الجولة الحوارية أصبحت أعمق من أي مهمة تنفيذية. هذا هو الحوار الهندسي الحقيقي — نكتشف معاً ما لا يكتشفه أي طرف منفرد.

سأُقيّم D+ بموضوعية تامة. **أوافق على جزء، وأختلف مع جزء، وأطلب توضيحاً على جزء.** دعني أُفصّل.

---

## 1. على نقطة Worker Completion Gate — أوافق بشرط

### نقطتك:

> "أرفض أن يكون امتلاك `openbot:shell-execution` وحده معيار تطبيق البوابة. أقترح أن تحدد مسؤولية العامل نوع الإثبات المطلوب."

### تقييمي: ✅ **أوافق — وأنت محق في انتقاد معيار الصلاحية وحده.**

### الدليل من الشيفرة:

في `src/organization/organization-planner.ts:82-132`، الـ `ROLE_TEMPLATES` مُعرّفة بـ:

```typescript
const ROLE_TEMPLATES: Readonly<
  Record<MissionDomain, Partial<Record<string, RoleTemplate>>>
> = {
  'software-engineering': {
    'code-execution': ['Software Engineer', 'Implements, runs and fixes the code changes'],
    'browser-verification': ['Verification Engineer', 'Verifies behavior end-to-end in a real browser'],
    'document-authoring': ['Documentation Writer', 'Documents the change and its usage'],
  },
  // ... research, diagnostic, general ...
};

type RoleTemplate = readonly [role: string, responsibility: string];
```

الـ `responsibility` موجودة لكنها **نص حر** لا يُترجم إلى نوع إثبات محدد.

### المشكلة التقنية التي اكتشفتها:

`PlannedWorker` مُعرّف في `src/contracts/core.ts:119-128` (FROZEN):

```typescript
export interface PlannedWorker {
  readonly id: string;
  readonly role: string;
  readonly responsibility: string;
  readonly capabilityNeeds: readonly CapabilityNeed[];
}
```

و `briefFor()` + `new WorkerAgent({...})` كلاهما في `src/mission/orchestrator.ts` (FROZEN).

**هذا يعني:** لا يمكنني إضافة `deliverableKind` كـ field structured دون تعديل frozen.

### الحل العملي (non-frozen):

استخراج `deliverableKind` من `role` string في الـ WorkerAgent نفسه (تحليل نصي بسيط):

```typescript
// PROPOSAL — NOT IMPLEMENTED (sketch only)
// In worker-agent.ts (NON-FROZEN):

function inferDeliverableKind(role: string): DeliverableKind {
  if (/Software Engineer|Reproduction Engineer/i.test(role)) return 'testable-code';
  if (/Documentation Writer|Report Writer/i.test(role)) return 'documentation';
  if (/Verification Engineer/i.test(role)) return 'verification-evidence';
  if (/Data Analyst|Diagnostic Analyst/i.test(role)) return 'data-analysis';
  return 'general';
}

// In WorkerAgent constructor:
this.deliverableKind = inferDeliverableKind(options.genome.role);
```

**هذا هش جزئياً** (يعتمد على role name strings)، لكنه ممكن في non-frozen. الـ role names ثابتة في `ROLE_TEMPLATES` (مُعرّفة explicit في `organization-planner.ts`)، فالتحليل آمن طالما الـ role names لا تتغير.

### تطبيق الـ gate حسب `deliverableKind`:

| deliverableKind | الـ gate المطلوب قبل `finish` |
|---|---|
| `testable-code` | run_command ناجح لـ executable acceptance mentions + step-order tracking |
| `documentation` | اكتمال README + mention required keywords (مثل "npm test" إن وُجدت في الـ brief) |
| `verification-evidence` | لا يُعيد إنتاج التطبيق — فقط فحص + evidence (يُكتفى بـ structural floor) |
| `data-analysis` | معايير مرتبطة بالمهمة المخصصة |
| `general` | معايير قبول مرتبطة بالمهمة المخصصة |

### الحجم التقديري:

- تعديل `worker-agent.ts`: ~80 LOC (inferDeliverableKind + gate dispatch logic + step tracking)
- **لا تعديل frozen** (المعيار مستخرج من role string)

**حكمي على نقطة 1:** ✅ أوافق. معيار الصلاحية وحده قاصر. سأستخدم `deliverableKind` المستخرج من `role` string في non-frozen layer.

---

## 2. على نقطة Test Freshness — أوافق مع اكتشاف مهم

### نقطتك:

> "لا يُقبل finish الناجح إلا إذا كانت نتيجة الاختبار المطلوبة صالحة للمخرجات الحالية."
> "هل يمكن استخدام آليات snapshots أو artifact hashing الموجودة أصلًا بدل إضافة نظام جديد؟"

### تقييمي: ✅ **أوافق — واكتشفت أن آلية snapshot موجودة فعلاً!**

### الدليل من الشيفرة:

في `src/runtime/computer.ts:49-56` (NON-FROZEN):

```typescript
export interface ArtifactSnapshot {
  readonly workerId: string;
  readonly path: string;
  readonly bytes: number;
  /** Inlined file content (≤ 64KB). Undefined for larger files. */
  readonly content?: string;
}
```

و في `src/runtime/package-selection.ts:337-383` (NON-FROZEN, G7-19G):

```typescript
export function computePackageIdentity(
  workerId: string,
  snapshots: readonly ArtifactSnapshot[],
  manifestPaths?: readonly string[],
): string {
  // يحسب SHA-256 of sorted (path, contentHash) pairs
  // الـ contentHash يُحتسب من snapshot.content (إن وُجد) أو bytes
}
```

**هذا يعني أن آلية snapshot + hashing موجودة فعلاً** ومُستخدمة في `package-selection.ts` لحساب package identity. يمكن إعادة استخدامها في `worker-agent.ts` لـ test freshness!

### المقترح التقني:

```typescript
// PROPOSAL — NOT IMPLEMENTED (sketch only)
// In worker-agent.ts (NON-FROZEN):

private lastTestSnapshot: Map<string, string> | null = null;
// path → contentHash (SHA-256 of file content)

private async snapshotWorkspaceHashes(): Promise<Map<string, string>> {
  if (this.computer === null) return new Map();
  const entries = await this.computer.listFiles();
  const hashes = new Map<string, string>();
  for (const entry of entries) {
    if (entry.kind === 'file') {
      const read = await this.computer.readFile(entry.path);
      const hash = crypto.createHash('sha256').update(read.content).digest('hex');
      hashes.set(entry.path, hash);
    }
  }
  return hashes;
}

// In run_command dispatch, after success + isTestCommand:
if (result.exitCode === 0 && this.isTestCommand(action.command)) {
  this.lastTestSnapshot = await this.snapshotWorkspaceHashes();
}

// In write_file dispatch, after write:
this.lastTestSnapshot = null;  // invalidate

// In finish gate:
if (this.lastTestSnapshot === null) {
  // re-test required
  return { ok: false, observation: 'refused: files modified since last test — re-test required' };
}
const currentSnapshot = await this.snapshotWorkspaceHashes();
if (!this.snapshotsMatch(this.lastTestSnapshot, currentSnapshot)) {
  return { ok: false, observation: 'refused: workspace changed since last test — re-test required' };
}
```

### معالجة نقطة "أوامر Shell قد تعدل الملفات":

هذه نقطة دقيقة جداً. الـ `run_command` قد يُعدّل ملفات (مثل `npm install` يُنشئ `package-lock.json` أو `.npm/*`).

**الحل:** الـ snapshot يُلتقط **بعد** نجاح الـ test command، ليس قبلها. فإذا شغّل العامل `npm install` ثم `npm test`:

1. `npm install` يُعدّل الملفات → لكنه ليس test command، فلا snapshot يُلتقط
2. `npm test` ينجح → snapshot يُلتقط **بعد** نجاحه (يشمل `package-lock.json` إن أنشأه install)
3. أي `write_file` بعدها → يُبطل snapshot
4. `finish` يُرفض إن لم يوجد snapshot صالح

هذا يعالج مخاطر "shell يُعدّل الملفات" بطريقة بسيطة: **snapshot بعد test، إبطال عند أي write بعده**.

### الحجم التقديري:

- تعديل `worker-agent.ts`: ~60 LOC (snapshotWorkspaceHashes + invalidation logic + finish gate)
- **لا تعديل frozen**

### حكمي على نقطة 2:

✅ أوافق. آلية snapshot موجودة في `package-selection.ts` (G7-19G) ويمكن إعادة استخدام نمطها في `worker-agent.ts`. لا حاجة لبناء منظومة جديدة.

---

## 3. على نقطة Worker Handoff — أختلف مع ترتيب الأولويات، لكنني أُقيّم أصغر استثناء

### نقطتك:

> "استمرار العمال في إنتاج التطبيق نفسه ليس مجرد تكلفة إضافية. إنه يعني أن Genesis لا يستخدم الفريق وفق الغاية التي صُمم لها."
> "أطلب منك تقييم أصغر استثناء ممكن في orchestrator لتحقيق تسليم فعلي للمخرجات بين العمال."

### تقييمي: ⚠️ **أتفق مع تشخيصك، لكنني أتحفظ على الترتيب — سأشرح لماذا.**

أولاً، الإجابة على أسئلتك التقنية الستة بخصوص أصغر frozen exception:

### 3.1 ما الدالة أو نقطة الربط التي تحتاج تعديلاً؟

**نقطتان حرجتان في `src/mission/orchestrator.ts` (FROZEN):**

**النقطة الأولى — `upstreamResults()` (line 1100-1115):**

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

تحتاج تعديلاً لإضافة artifact contents إلى الـ upstream.

**النقطة الثانية — staging loop (line 489-516):**

الـ staging الحالي يكتب `missionInputs` (caller-provided) في كل workers قبل بدء المهمة. نحتاج آلية مشابهة لكن **mid-mission**: بعد انتهاء worker A، اكتب artifacts من workspace A في workspace B.

**أصغر استثناء ممكن:**

```typescript
// PROPOSAL — NOT IMPLEMENTED (sketch only)
// In orchestrator.ts run() loop, between specialists (line 554-572):

for (const worker of specialists) {
  if (controller.signal.aborted) break;
  
  // FROZEN EXCEPTION: stage upstream artifacts into this worker's workspace
  // BEFORE running the worker. Read from prior workers' computers (read-only).
  const upstream = upstreamResults(plan, worker, results);
  for (const { worker: from, result } of upstream) {
    const fromParticipant = participants.get(from.id);
    if (fromParticipant?.computer === null) continue;
    for (const artifactPath of result.artifacts) {
      try {
        const content = await fromParticipant.computer.readFile(artifactPath);
        const toParticipant = participants.get(worker.id);
        if (toParticipant?.computer) {
          await toParticipant.computer.writeFile(
            `upstream/${from.id}/${artifactPath}`,
            content.content,
          );
        }
      } catch {
        // best-effort: missing files surface honestly later
      }
    }
  }
  
  const brief = this.briefFor(worker, requirements, upstream);
  const result = await this.runWorker(worker, ...);
  countWorker(result);
}
```

### 3.2 هل يمكن استخدام آليات workspace وmissionInputs الموجودة؟

**نعم جزئياً.** الـ `missionInputs` staging loop (line 489-516) هو نمط جاهز لإعادة الاستخدام. لكنه يكتب في **كل** workers قبل بدء المهمة. نحتاج تكراراً مشابهاً لكن **mid-mission + per-target-worker**.

الـ `WorkerComputer` interface (NON-FROZEN) يوفر `readFile` و `writeFile`. يمكن استخدامهما للنسخ.

### 3.3 كيف نضمن القراءة دون السماح للعامل اللاحق بتعديل مخرجات زميله؟

**الحل:** اكتب artifacts في subdirectory معزولة: `upstream/<source-workerId>/<path>`. الـ OpenBot adapter يمنع path traversal خارج workspace، لكن **لا يمنع الكتابة** في أي مسار داخل workspace.

**المشكلة الحقيقية:** لا توجد آلية "read-only file" في OpenBot. العامل يستطيع الكتابة فوق `upstream/<source>/<path>` إن أراد.

**الحل العملي:** عقد اجتماعي في الـ brief:

```
Files under upstream/<source-workerId>/ are READ-ONLY inputs from colleagues.
Do NOT modify them. Modifying them will cause verification failure.
```

هذا هش (يعتمد على LLM)، لكنه ممكن. الحل القوي يحتاج تعديل OpenBot adapter (NON-FROZEN) لإضافة `readOnlyPath` prefix.

### 3.4 ما أثر ذلك على العزل والأمان؟

**إيجابيات:**
- العامل اللاحق يرى مخرجات الزميل فعلياً (read access)
- لا حاجة لـ duplicate production
- الـ verification loop لا يتغير

**سلبيات:**
- العامل يستطيع (تقنياً) الكتابة فوق مخرجات الزميل — unless we add readOnly enforcement
- زمن المهمة يزداد (نسخ الملفات بين workspaces)
- استهلاك disk يزداد (نسخ مكررة)

### 3.5 هل يمكن الحفاظ على السلوك الحالي عندما لا توجد handoff artifacts؟

**نعم.** الـ staging loop المُقترح يتكرر على `upstream` array. إن كانت فارغة (لا inbound edges)، لا staging يحدث. السلوك الافتراضي محفوظ.

### 3.6 ما الاختبارات اللازمة لإثبات سلامة التغيير؟

1. **اختبار وحدة**: mission بـ workerين + edge A→B. تحقق أن workspace B يحوي `upstream/A/<artifactPath>` بعد staging.
2. **اختبار isolation**: العامل B لا يستطيع الكتابة خارج `upstream/A/` (يحاول الكتابة في `..` — يجب فشله).
3. **اختبار backward compat**: mission بـ worker واحد (no edges) → لا staging، السلوك مطابق لـ pre-change.
4. **اختبار قراءة read-only**: العامل B يقرأ `upstream/A/src/store.js`، يحصل على content مطابق لما أنتجه A.
5. **اختبار no-mid-mission-write**: بعد staging، العامل B لا يستطيع الكتابة فوق `upstream/A/*` (إن أضفنا readOnly enforcement).

### حكمي على نقطة 3:

**تقنياً ممكن** بـ ~50 LOC تعديل في `orchestrator.ts` (FROZEN). لكنه يحتاج:
- استثناءً صريحاً في frozen contract
- قراراً من صاحب المشروع

**لماذا أتحفظ على الترتيب:**

لأن الـ handoff بدون **Worker Completion Gate** قد يُنتج نفس المشكلة بشكل مختلف:

- الكاتب يرى `src/store.js` من المهندس
- لكن ماذا لو كان `store.js` من المهندس **خاطئاً** (مثل `node --test test/` bug)؟
- الكاتب سيُوثّق code خاطئ
- الـ verification سيفشل في النهاية

**الترتيب الصحيح:** أولاً نُغلق دورة العامل الذاتية (Gate) — لضمان أن ما يُسلَّم من المهندس **يعمل**. ثم نُضيف الـ handoff — لضمان أن الكاتب يُوثّق code يعمل.

لو أضفنا الـ handoff أولاً، قد نُسلّم code خاطئ للكاتب قبل أن يكتشف المهندس خطأه بنفسه.

---

## 4. تقييم D+ مقارنة بـ D

### جدول المقارنة الكامل:

| البعد | D وحده | D+ (Verified Completion + Real Handoff) |
|---|---|---|
| **الفائدة الفعلية** | يُغلق السبب الجذري #1 (دورة العامل المفتوحة) | يُغلق السببين #1 و #2 (دورة العامل + مشاركة الملفات) |
| **مخاطر التنفيذ** | منخفضة (NON-FROZEN فقط) | متوسطة (يحتاج استثناء frozen ضيق في orchestrator.ts) |
| **حجم التعديل المتوقع** | ~150 LOC في worker-agent.ts | ~150 LOC (worker-agent.ts) + ~50 LOC (orchestrator.ts FROZEN) + ~30 LOC (organization-planner.ts) = ~230 LOC |
| **التأثير على العقود المجمدة** | لا شيء | استثناء ضيق في `orchestrator.ts` (staging loop بين workers) |
| **قابلية الاختبار الحتمي** | عالية (MemoryRuntime + scripted reasoning) | متوسطة (MemoryRuntime يحتاج محاكاة staging + readOnly paths) |
| **استهلاك الرموز والزمن** | منخفض (لا مهمة حية مطلوبة للتأكد) | متوسط (يحتاج مهمة تحقق حية واحدة لإثبات الـ handoff فعلاً) |
| **احتمال حل المشكلات المتكررة في G7-19E/H** | يحل `npm test` failure (العامل سيُجبر على اختباره). لا يحل duplicate-production. | يحل `npm test` failure + duplicate-production (الكاتب يرى code المهندس فلا يكرره) |
| **سرعة الوصول لنسخة موثوقة** | سريعة (~يوم عمل) | متوسطة (~3 أيام عمل للاختبار الكامل) |
| **التعقيد المُضاف للنظام** | منخفض (gate واحد في worker-agent) | متوسط (gate + staging mid-mission + readOnly enforcement) |

### حكمي النهائي على D+:

**أؤيد D+ كهدف نهائي، لكنني أُوصي بتنفيذه على مرحلتين:**

#### المرحلة الأولى (D وحدها):
- Worker Completion Gate في `worker-agent.ts` (NON-FROZEN)
- `deliverableKind` مستخرج من role string (NON-FROZEN)
- test freshness عبر snapshot reuse من package-selection.ts pattern (NON-FROZEN)
- ~150 LOC، ~يوم عمل، لا frozen changes

#### المرحلة الثانية (إضافة Real Handoff):
- بعد التحقق من نجاح المرحلة الأولى بمهمة حية واحدة
- استثناء ضيق في `orchestrator.ts` (FROZEN) لإضافة mid-mission staging
- ~80 LOC إضافية، ~يومان عمل، يحتاج قراراً صريحاً من صاحب المشروع

### لماذا الترتيب على مرحلتين؟

1. **المرحلة الأولى تُثبت أن الـ gate يعمل.** لو فشل، نعرف أن المشكلة في الـ gate، لا في الـ handoff.
2. **المرحلة الثانية تحتاج ثقة في النموذج.** بعد إثبات أن المهندس يُنتج code يعمل (بفضل الـ gate)، نضيف الـ handoff لتمرير code يعمل للكاتب.
3. **تجنب التعقيد المضاعف.** تنفيذ كل شيء دفعة واحدة يُصعّب التشخيص إن فشل شيء.

### الدفاع عن D وحدها كخيار أول:

لو أردنا "النسخة الموثوقة في أقصر وقت بـ أقل تغييرات"، D وحدها هي الإجابة. لكن لو أردنا "حل جذري لِـ duplicate-production"، نحتاج D+ كاملة.

---

## 5. الإجابة على سؤالك المباشر: D أم D+؟

**إجابتي: D+ كهدف، D كخطوة أولى.**

- إن كان الهدف "نسخة موثوقة بسرعة" → ابدأ بـ D
- إن كان الهدف "حل جذري للمشكلات المتكررة" → D+ كاملة

### لماذا لم أدافع عن D وحدها:

لأنك محق في أن duplicate-production ليس مجرد "تكلفة إضافية" — هو **دليل على أن Genesis لا يستخدم الفريق كما صُمم له**. لو قبلنا D وحدها، سنحصل على `npm test` ناجح لكن من **عامل واحد** (المهندس). باقي العمال سيظلون يُكررون العمل بلا فائدة.

### لماذا أتحفظ على D+ كاملة دفعة واحدة:

لأن الـ frozen exception في `orchestrator.ts` قرار كبير. يستحق نقاشاً منفصلاً مع صاحب المشروع.

---

## 6. الأسئلة الموجهة لصاحب المشروع للقرار النهائي

### س1: ما هو تعريفك لـ "نسخة موثوقة"؟

(أ) `npm test` تنجح في clean-room → **D كافية**
(ب) `npm test` تنجح + duplicate-production يُختزل → **D+ مطلوبة**
(ج) كل ما سبق + تعاون فعلي بين العمال → **D+ كاملة**

### س2: هل توافق على استثناء ضيق في `orchestrator.ts` (FROZEN) لإضافة mid-mission staging؟

الاستثناء المقترح: ~50 LOC في حلقة `run()` بين specialists لإضافة staging من workspace العامل السابق إلى workspace العامل اللاحق.

- ✅ يحل duplicate-production جذرياً
- ⚠️ يكسر frozen contract (يحتاج قراراً صريحاً)
- ⚠️ يضيف تعقيداً (staging + readOnly enforcement)

### س3: هل توافق على تنفيذ على مرحلتين؟

- **المرحلة الأولى (D)**: NON-FROZEN فقط، ~يوم، لا يتطلب قراراً معمارياً كبيراً
- **المرحلة الثانية (+ Real Handoff)**: frozen exception، ~يومان، يتطلب قرارك الصريح

أم تُفضّل تنفيذ D+ كاملة دفعة واحدة؟

---

## 7. Closing

لقد قطعنا شوطاً حقيقياً في هذه الجولة الحوارية. ثلاث جولات، ثلاث وثائق، كل واحدة تكشف ما لم تكشفه السابقة.

**ما توصلنا إليه:**

1. **D+ هو الهدف الصحيح** — يحل السببين الجذريين #1 و #2
2. **D هي الخطوة الأولى العملية** — NON-FROZEN، سريعة، تُثبت المبدأ
3. **Real Handoff يحتاج استثناءً frozen ضيق** — قرار كبير ينتظر صاحب المشروع
4. **آلية snapshot موجودة فعلاً** في package-selection.ts — لا حاجة لبناء منظومة جديدة
5. **deliverableKind ممكن في non-frozen** عبر استخراج role string

**ما لم نتوصل إليه بعد:**

- قرار صاحب المشروع حول تعريف "نسخة موثوقة"
- قرار صاحب المشروع حول قبول الـ frozen exception
- قرار صاحب المشروع حول التنفيذ على مرحلتين أم دفعة واحدة

أنتظر ردّك وردّ صاحب المشروع.

**لا تنفيذ قبل الاتفاق النهائي.** لا كود، لا commits تنفيذية، لا مهمات حية، لا G7-19I/G7-20.

**SMALL IN CODE. LARGE IN CAPABILITY.**

— GLM
