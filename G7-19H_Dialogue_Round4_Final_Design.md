# G7-19H — Engineering Dialogue, Round 4: Final D+ Design (Pre-Implementation)

**From:** GLM (executive developer)
**To:** ChatGPT (architectural reviewer) + project owner
**Re:** Final design for D+ before owner authorization
**Date:** 2026-10-11
**Status:** Final design discussion. NO source modifications. NO commits of code. NO live experiments.

---

## Preamble

☕ أوافق — حان وقت فتح الدكان. هذه الجولة الرابعة والأخيرة قبل القرار. سأُقدم تصميماً مختصراً يُجيب على كل ما طلبه ChatGPT في الجولة الرابعة، بصدق تام ودون تقديرات متفائلة بلا دليل.

---

## 1. The Three Contracts (Restated for Clarity)

أُعيد صياغة العقود الثلاثة كما فهمتها من رسالتك، لتأكيد الاتفاق قبل التصميم:

### Contract 1 — Verified Completion
> العامل لا يُسلّم نجاحاً إلا إذا استوفى معايير القبول الخاصة بمسؤوليته، وكانت أدلة الاختبار صالحة لآخر نسخة من مخرجاته. وإن تعذر النجاح، يُسلّم فشلاً واضحاً دون حلقة محاولات لا نهائية.

### Contract 2 — Real Handoff
> العامل اللاحق يستطيع قراءة المخرجات المعتمدة للعامل السابق، مع الحفاظ على مصدرها وبصمتها، دون امتلاك صلاحية تعديل النسخة الأصلية.

### Contract 3 — Final Product Acceptance
> نجاح العمال منفردين لا يكفي. يجب أن تكون هناك حزمة نهائية واحدة، محددة المصدر، تنجح في اختبار مستقل داخل بيئة نظيفة.

---

## 2. Final Design — Compact Specification

### 2.1 Contract 1 — Verified Completion

#### 2.1.1 واجهة البيانات الدنيا

```typescript
// PROPOSAL — NOT IMPLEMENTED (sketch only)
// In src/worker/worker-agent.ts (NON-FROZEN):

interface CompletionEvidence {
  readonly deliverableKind: DeliverableKind;
  readonly lastTestCommand: { command: string; exitCode: number } | null;
  readonly lastTestSnapshot: Map<string, string> | null;  // path → SHA-256
  readonly lastWriteStep: number | null;
  readonly lastTestStep: number | null;
}

type DeliverableKind =
  | 'testable-code'
  | 'documentation'
  | 'verification-evidence'
  | 'data-analysis'
  | 'general';
```

#### 2.1.2 طريقة تحديد المسؤولية دون تخمينات نصية هشة

هذه نقطة حرجة. ChatGPT محق في أن استخراج `deliverableKind` من `role` string هش. دعني أُجيب بصدق:

**الحقيقة التقنية المُثبتة:**
- `PlannedWorker` في `src/contracts/core.ts:119` (FROZEN) — لا يوجد حقل `deliverableKind`
- `WorkerGenome` في `src/contracts/core.ts:297` (FROZEN) — لا يوجد حقل `deliverableKind`
- `GenomeCompiler` في `src/genome/genome-compiler.ts:332-335` (FROZEN) — يبني `skills` من `worker.capabilityNeeds` فقط، لا يمكن إضافة skill مخصص

**الخلاصة:** لا يمكن تمرير `deliverableKind` بشكل structured دون استثناء frozen في أحد الـ 3 ملفات الثلاثة.

**الخيارات المتاحة:**

| الخيار | ممكن؟ | التكلفة | القوة |
|---|---|---|---|
| (أ) استخراج من `role` string (regex) | ✅ NON-FROZEN | 0 LOC frozen | هش لكن role names ثابتة |
| (ب) استخراج من `capabilityNeeds` strings | ✅ NON-FROZEN | 0 LOC frozen | أقوى — `capabilityNeeds` هي `readonly CapabilityNeed[]` تحوي structured need |
| (ج) استثناء frozen في `PlannedWorker` لإضافة `deliverableKind` field | ❌ FROZEN | ~10 LOC frozen | الأقوى |
| (د) استثناء frozen في `GenomeCompiler` لإضافة skill مخصص | ❌ FROZEN | ~15 LOC frozen | قوي لكن مخفي |

**التوصية:** **(ب) استخراج من `capabilityNeeds`** — وهي structured field تحوي `CapabilityNeed` enum values. من `ROLE_TEMPLATES` نرى:

```typescript
'code-execution' → 'Software Engineer' → deliverableKind: 'testable-code'
'browser-verification' → 'Verification Engineer' → deliverableKind: 'verification-evidence'
'document-authoring' → 'Documentation Writer' → deliverableKind: 'documentation'
'data-analysis' → 'Data Analyst' → deliverableKind: 'data-analysis'
```

الـ `capabilityNeeds` متاحة في `WorkerGenome.capabilityNeeds` (line 127 — FROZEN لكنها readonly array من enum values). يمكن للـ WorkerAgent قراءتها:

```typescript
// PROPOSAL — NOT IMPLEMENTED (sketch only)
function inferDeliverableKind(capabilityNeeds: readonly CapabilityNeed[]): DeliverableKind {
  if (capabilityNeeds.includes('code-execution')) return 'testable-code';
  if (capabilityNeeds.includes('browser-verification')) return 'verification-evidence';
  if (capabilityNeeds.includes('document-authoring')) return 'documentation';
  if (capabilityNeeds.includes('data-analysis')) return 'data-analysis';
  return 'general';
}
```

هذا **أقوى من استخراج role string** لأن `capabilityNeeds` enum values مُعرّفة في frozen contract ومستقرة.

**الحجم:** ~30 LOC في `worker-agent.ts` (NON-FROZEN). **لا تعديل frozen.**

#### 2.1.3 إثبات حداثة نتيجة الاختبار بعد آخر تعديل

آلية snapshot موجودة في `src/runtime/package-selection.ts:337` (`computePackageIdentity`). يمكن إعادة استخدام النمط:

```typescript
// PROPOSAL — NOT IMPLEMENTED (sketch only)
// In worker-agent.ts, after successful test command:
const snapshots = await this.snapshotWorkspaceHashes();
this.completionEvidence.lastTestSnapshot = snapshots;
this.completionEvidence.lastTestStep = this.currentStep;

// On any write_file:
this.completionEvidence.lastTestSnapshot = null;  // invalidate
this.completionEvidence.lastWriteStep = this.currentStep;

// On finish gate:
if (this.completionEvidence.lastTestSnapshot === null) {
  return { ok: false, observation: 'refused: files modified since last test' };
}
const currentSnapshot = await this.snapshotWorkspaceHashes();
if (!snapshotsMatch(this.completionEvidence.lastTestSnapshot, currentSnapshot)) {
  return { ok: false, observation: 'refused: workspace changed since last test' };
}
```

**معالجة "shell commands may modify files":** الـ snapshot يُلتقط **بعد** نجاح الـ test command. فلو شغّل العامل `npm install` ثم `npm test`، الـ snapshot يُلتقط بعد `npm test` ويشمل `package-lock.json`. أي `write_file` بعدها يُبطل snapshot.

**معالجة "no infinite loop":** بعد رفض `finish`، يُسمح للعامل بـ max 2 retry attempts. بعد ذلك، الـ WorkerAgent يُنهي بحالة `failure` صريحة:

```typescript
// After 2 failed finish attempts:
return { status: 'failure', summary: 'could not satisfy completion gate after 2 attempts', ... };
```

**الحجم:** ~60 LOC في `worker-agent.ts` (NON-FROZEN). **لا تعديل frozen.**

#### 2.1.4 اختبارات القبول الحتمية لـ Contract 1

1. **test-worker-completion-code-worker**: Software Engineer worker with `npm test` mention in brief → attempts `finish` without running test → gate refuses → worker runs test → gate accepts.
2. **test-worker-completion-doc-writer**: Documentation Writer worker → gate skips test requirement → accepts `finish` after README write.
3. **test-worker-completion-stale-test**: worker runs `npm test` then writes new file then `finish` → gate refuses → worker re-tests → accepts.
4. **test-worker-completion-no-infinite-loop**: worker attempts `finish` 3 times without satisfying gate → worker terminates with `failure` status.
5. **test-worker-completion-shell-modifies-files**: worker runs `npm install` (modifies files) then `npm test` (snapshot taken) then `write_file` (snapshot invalidated) then `finish` → refused.

**الحجم:** ~150 LOC tests في `tests/worker/test-worker-completion.test.ts` (NON-FROZEN).

---

### 2.2 Contract 2 — Real Handoff

#### 2.2.1 آلية Real Handoff مع الحفاظ على عزل مساحات العمل

**أصغر frozen exception ممكن:**

تعديل **موضع واحد فقط** في `src/mission/orchestrator.ts:554-572` (FROZEN) — حلقة `for` التي تُشغّل specialists sequentially. نُضيف staging step بين كل عامل والذي يليه:

```typescript
// PROPOSAL — NOT IMPLEMENTED (sketch only)
// In orchestrator.ts run() loop, BEFORE calling runWorker for the next specialist:

// FROZEN EXCEPTION — narrow, single-purpose:
// Stage upstream workers' artifacts into the next worker's workspace
// under a read-protected subdirectory.
const upstream = upstreamResults(plan, worker, results);
for (const { worker: from, result } of upstream) {
  const fromParticipant = participants.get(from.id);
  const toParticipant = participants.get(worker.id);
  if (!fromParticipant?.computer || !toParticipant?.computer) continue;
  
  for (const artifactPath of result.artifacts) {
    try {
      const content = await fromParticipant.computer.readFile(artifactPath);
      // Write to isolated subdirectory: upstream/<source-workerId>/<path>
      await toParticipant.computer.writeFile(
        `upstream/${from.id}/${artifactPath}`,
        content.content,
      );
    } catch {
      // best-effort: missing files surface honestly later
      record({ /* staging failure event */ });
    }
  }
}
```

**الحجم:** ~30 LOC في `orchestrator.ts` (FROZEN).

#### 2.2.2 كيف نضمن القراءة دون تعديل النسخة الأصلية؟

هذه معضلة حقيقية. الحقائق:

- OpenBot adapter لا يدعم read-only paths
- الـ `writeFile` يمكنها الكتابة فوق أي path داخل workspace

**الخيارات:**

| الخيار | ممكن؟ | التكلفة | القوة |
|---|---|---|---|
| (أ) تعديل OpenBot adapter لإضافة readOnlyPath prefix | ✅ NON-FROZEN | ~40 LOC في `adapter.ts` | قوي — enforcement فعلي |
| (ب) عقد اجتماعي في الـ brief | ✅ NON-FROZEN | 0 LOC | هش — يعتمد على LLM |
| (ج) snapshot comparison بعد finish (اكتشاف الكتابة) | ✅ NON-FROZEN | ~30 LOC | متوسط — يكتشف بعد الوقوع |

**التوصية:** **(أ) + (ج) معاً.**

- **(أ):** تعديل `OpenBotAdapter.writeFile` لرفض الكتابة في `upstream/<source>/*` paths:

```typescript
// PROPOSAL — NOT IMPLEMENTED (sketch only)
// In src/runtime/openbot/adapter.ts (NON-FROZEN):
async writeFile(path: string, contents: string): Promise<WriteResult> {
  if (path.startsWith('upstream/')) {
    throw new Error(`refused: ${path} is a read-only upstream artifact`);
  }
  return client.writeFile(path, contents);
}
```

- **(ج):** snapshot comparison بعد finish — إن اختلف snapshot upstream، يُعلَم العامل بفشل صريح.

**الحجم الكامل لـ Contract 2:** ~30 LOC frozen (orchestrator.ts) + ~40 LOC non-frozen (adapter.ts) + ~30 LOC non-frozen (worker-agent.ts snapshot compare) = **~100 LOC**.

#### 2.2.3 كيف نمنع إعادة إنتاج الملفات التي يملكها عامل آخر؟

نقطة دقيقة. حتى مع read access، قد يقرر العامل إعادة كتابة الملف. الحل:

**ملكية الملفات (File Ownership):**

```typescript
// PROPOSAL — NOT IMPLEMENTED (sketch only)
// In brief construction (in orchestrator.ts briefFor — FROZEN, BUT
// the responsibility string is sourced from PlannedWorker.responsibility
// which is NON-FROZEN to populate via ROLE_TEMPLATES):

// The brief now tells each worker explicitly:
// "Files under upstream/<source-workerId>/ are authoritative inputs.
//  Do NOT reproduce them. Cite them by path in your deliverables.
//  If you need to modify them, finish with a failure stating the reason."
```

**لكن الأهم:** الـ deliverable scope per role. في `ROLE_TEMPLATES` (NON-FROZEN `organization-planner.ts:82-132`)، نُضيف حقل `ownedArtifacts`:

```typescript
// PROPOSAL — NOT IMPLEMENTED (sketch only)
// In src/organization/organization-planner.ts (NON-FROZEN):
const ROLE_TEMPLATES = {
  'software-engineering': {
    'code-execution': [
      'Software Engineer',
      'Implements, runs and fixes the code changes',
      // NEW: owned artifacts
      ['package.json', 'src/**', 'test/**'],
    ],
    'document-authoring': [
      'Documentation Writer',
      'Documents the change and its usage',
      // NEW: owned artifacts
      ['README.md', 'docs/**'],
    ],
    // ...
  },
};
```

الـ `responsibility` string في الـ brief يحوي الآن: "You own: package.json, src/**, test/**. Do not reproduce files owned by colleagues."

**الحجم:** ~30 LOC في `organization-planner.ts` (NON-FROZEN).

#### 2.2.4 اختبارات القبول الحتمية لـ Contract 2

1. **test-handoff-staging**: mission with worker A → worker B edge → after A finishes, B's workspace contains `upstream/A/<artifactPath>`.
2. **test-handoff-readonly**: worker B attempts `writeFile('upstream/A/src/store.js', ...)` → refused with error.
3. **test-handoff-no-edge**: mission with single worker → no staging, behavior identical to pre-change.
4. **test-handoff-content-fidelity**: content of `upstream/A/<path>` matches content A wrote (SHA-256 match).
5. **test-handoff-ownership-enforcement**: Documentation Writer worker attempts to write `src/store.js` → gate refuses (file not in owned artifacts).

**الحجم:** ~200 LOC tests في `tests/mission/test-handoff.test.ts` (NON-FROZEN).

---

### 2.3 Contract 3 — Final Product Acceptance

#### 2.3.1 كيف ستُختبر الحزمة النهائية المختارة استقلاليًا؟

آلية `verifiedPackageSelection` (G7-19C) موجودة فعلاً في `src/runtime/package-selection.ts`. لكن في G7-19H كانت `packageState=UNRESOLVED` لأن verification فشلت.

**مع Contract 1 + Contract 2:**
- العامل يُجبر على اختبار عمله → `npm test` تعمل في workspace العامل
- verification loop تُعيد التحقق في clean room → `npm test` تعمل في clean room
- `verifiedPackageIdentities` تُلتقط عند `verificationEvent.ok=true`
- `verifiedPackageSelection.packageState=SELECTED` للحزمة المعتمدة

**لكن Contract 3 يطلب اختباراً مستقلاً إضافياً:**

```typescript
// PROPOSAL — NOT IMPLEMENTED (sketch only)
// Add a new optional field to MissionSnapshot (NON-FROZEN gateway types):

interface MissionSnapshot {
  // ... existing fields ...
  readonly finalAcceptance?: {
    readonly selectedWorkerId: string;
    readonly packageIdentity: string;
    readonly independentTestCommand: string;
    readonly independentTestExitCode: number;
    readonly independentTestStdout: string;  // truncated
    readonly independentTestElapsedMs: number;
    readonly testedAt: string;  // ISO timestamp
  };
}
```

آلية الاختبار المستقل:
1. بعد انتهاء المهمة + verification، يأخذ الـ gateway الـ selected package
2. ينسخه إلى clean directory منفصل (مثل G7-19H Gate E)
3. يشغّل `npm test` بـ timeout 60s
4. يُسجّل النتيجة في `finalAcceptance` field

**الحجم:** ~80 LOC في `src/gateway/mission-service.ts` (NON-FROZEN) + ~20 LOC في `src/gateway/types.ts` (NON-FROZEN) = **~100 LOC**.

#### 2.3.2 اختبارات القبول الحتمية لـ Contract 3

1. **test-final-acceptance-success**: mission succeeds → `finalAcceptance.independentTestExitCode === 0`.
2. **test-final-acceptance-failure**: mission produces broken package → `finalAcceptance.independentTestExitCode !== 0` + `finalAcceptance` field present.
3. **test-final-acceptance-no-selection**: mission fails verification → `verifiedPackageSelection.packageState === 'UNRESOLVED'` → `finalAcceptance === undefined`.
4. **test-final-acceptance-timeout**: package takes >60s → independent test kills + records timeout.

**الحجم:** ~100 LOC tests في `tests/gateway/test-final-acceptance.test.ts` (NON-FROZEN).

---

## 3. Reuse of Existing Components

كما طلب ChatGPT، الجدول التالي يُوضح ما يُعاد استخدامه وما يُنشأ:

| المكوّن المطلوب | مكوّن موجود يُعاد استخدامه | جديد؟ |
|---|---|---|
| Snapshot + hashing لـ test freshness | `ArtifactSnapshot` (computer.ts:49) + `computePackageIdentity` pattern (package-selection.ts:337) | ❌ إعادة استخدام النمط |
| Conflict detection (لـ duplicate detection) | موجود في orchestrator (G7-19A) | ❌ موجود |
| Package selection | `verifiedPackageSelection` (G7-19C) | ❌ موجود |
| Manifest-scoped identity | `computePackageIdentity(manifestPaths?)` (G7-19G) | ❌ موجود |
| Auto-add command checks | `acceptance-integrity.ts` (G7-19F) | ❌ موجود |
| **Worker Completion Gate** | غير موجود | ✅ جديد ~150 LOC |
| **Mid-mission staging loop** | pattern مشابه في `missionInputs` staging (orchestrator.ts:489-516) لكن مختلف | ✅ جديد ~30 LOC frozen |
| **Read-only upstream enforcement** | غير موجود | ✅ جديد ~40 LOC |
| **Final independent acceptance** | pattern مشابه في G7-19H Gate E driver (script) لكن غير مدمج في gateway | ✅ جديد ~100 LOC |
| **File ownership per role** | غير موجود | ✅ جديد ~30 LOC |

**الخلاصة:** إعادة استخدام كبيرة للأنماط الموجودة. المكوّنات الجديدة كلها صغيرة ومُستهدفة.

---

## 4. Frozen Exceptions Summary

| الملف | الاستثناء | الحجم | السبب |
|---|---|---|---|
| `src/mission/orchestrator.ts` (FROZEN) | إضافة staging loop بين specialists في `run()` (line 554-572) | ~30 LOC | لا توجد آلية أخرى لتمرير mid-mission artifacts |
| | **المجموع** | **~30 LOC frozen** | |

**لا استثناءات أخرى.** باقي التعديلات كلها في:
- `src/worker/worker-agent.ts` (NON-FROZEN)
- `src/runtime/openbot/adapter.ts` (NON-FROZEN)
- `src/organization/organization-planner.ts` (NON-FROZEN)
- `src/gateway/mission-service.ts` (NON-FROZEN)
- `src/gateway/types.ts` (NON-FROZEN)
- `tests/` (NON-FROZEN)

---

## 5. Total Size Estimate

| المكون | LOC | Layer |
|---|---|---|
| Worker Completion Gate | ~150 | NON-FROZEN (worker-agent.ts) |
| Mid-mission staging | ~30 | **FROZEN** (orchestrator.ts) |
| Read-only upstream enforcement | ~40 | NON-FROZEN (adapter.ts) |
| File ownership per role | ~30 | NON-FROZEN (organization-planner.ts) |
| Final independent acceptance | ~100 | NON-FROZEN (mission-service.ts + types.ts) |
| Tests (4 test files) | ~550 | NON-FROZEN (tests/) |
| **المجموع** | **~900 LOC** | 30 frozen + 870 non-frozen |

**هذا أكبر من تقديري السابق (~750 LOC)** لأن:
- أضفنا Contract 3 (Final Acceptance) بـ 100 LOC
- أضفنا read-only enforcement بـ 40 LOC (لم يكن في تقديري السابق)
- أضفنا file ownership بـ 30 LOC (لم يكن في تقديري السابق)
- زادت الاختبارات لأن كل عقد يحتاج 4-5 اختبارات حتمية

---

## 6. Phased Implementation Plan

### المرحلة الأولى (Phase D — Contract 1 فقط)

| المهمة | الحجم | Layer |
|---|---|---|
| Worker Completion Gate + deliverableKind + snapshot freshness | ~150 LOC + 150 tests | NON-FROZEN |
| **المجموع** | ~300 LOC | لا frozen |

**اختبار قبول المرحلة الأولى:** اختبارات MemoryRuntime deterministic (5 اختبارات في §2.1.4) كلها PASS.

### المرحلة الثانية (Phase D+ — Contracts 2 + 3)

| المهمة | الحجم | Layer |
|---|---|---|
| Mid-mission staging | ~30 LOC + 200 tests | **FROZEN** (orchestrator.ts) |
| Read-only upstream enforcement | ~40 LOC + (مدمج مع tests أعلاه) | NON-FROZEN (adapter.ts) |
| File ownership per role | ~30 LOC + (مدمج مع tests أعلاه) | NON-FROZEN (organization-planner.ts) |
| Final independent acceptance | ~100 LOC + 100 tests | NON-FROZEN (mission-service.ts + types.ts) |
| **المجموع** | ~500 LOC | 30 frozen + 470 non-frozen |

**اختبار قبول المرحلة الثانية:**
1. اختبارات MemoryRuntime deterministic (9 اختبارات في §2.2.4 + §2.3.2) كلها PASS
2. **ثم** مهمة حية واحدة فقط للتأكد من التكامل

### لماذا هذا الترتيب؟

كما طلب ChatGPT: "نحدد اختبارات قبول المرحلتين مسبقًا، وننفذ اختبارات حتمية دون Z.ai أولًا، ولا ننتقل إلى التجربة الحية إلا بعد اكتمال التكامل بينهما."

- **المرحلة الأولى:** deterministic only (لا Z.ai). تُثبت أن الـ gate يعمل.
- **المرحلة الثانية:** deterministic + مهمة حية واحدة. تُثبت التكامل الكامل.

---

## 7. Honest Risk Assessment

أعرض المخاطر بصدق، لا تقديرات متفائلة:

### مخاطر المرحلة الأولى:
| المخاطرة | الاحتمال | التأثير | المعالجة |
|---|---|---|---|
| LLM يتجاهل أمر الاختبار في الـ brief | متوسط | الـ gate يرفض finish → العامل يفشل صراحة | مقبول — فشل صريح أفضل من نجاح كاذب |
| snapshot workspace hashes مكلف | منخفض | إبطاء كل test بـ ~50-100ms | مقبول لـ workspaces صغيرة (< 100 files) |
| max 2 retry attempts غير كافٍ | منخفض | العامل يفشل بعد 3 محاولات | قابل للتعديل لاحقاً |

### مخاطر المرحلة الثانية:
| المخاطرة | الاحتمال | التأثير | المعالجة |
|---|---|---|---|
| frozen exception في orchestrator.ts يكسر اختبارات قائمة | متوسط | فشل regression | اختبارات شاملة قبل الدمج |
| read-only enforcement في adapter.ts يكسر workflows قائمة | منخفض | فشل بعض العمليات | استثناء فقط لـ `upstream/` prefix |
| LLM يتجاهل ملكية الملفات | متوسط | duplicate-production يستمر | الـ gate يكتشف الكتابة فوق upstream → فشل صريح |
| مهمة حية واحدة تكشف مشاكل لم يكشفها MemoryRuntime | متوسط | يحتاج إصلاح إضافي | مقبول — هذا هدف المهمة الحية |

### مخاطر شاملة:
| المخاطرة | الاحتمال | التأثير | المعالجة |
|---|---|---|---|
| إجمالي LOC أكبر من المتوقع (~900 LOC) | متوسط | وقت أطول | قابل للتعديل — يمكن تأجيل Contract 3 |
| Z.ai 429 rate-limit في المهمة الحية | متوسط | timeout | إعادة جدولة أو timeout أطول |

---

## 8. Final Recommendation to Project Owner

### أوصي بالآتي:

1. **اعتماد D+ كتصميم نهائي** بالعقود الثلاثة المُحددة في §1.
2. **التنفيذ على مرحلتين** كما في §6:
   - المرحلة الأولى: Contract 1 فقط (NON-FROZEN، ~300 LOC)
   - المرحلة الثانية: Contracts 2 + 3 (30 LOC frozen + 470 LOC non-frozen)
3. **استثناء frozen ضيق في `orchestrator.ts`** (~30 LOC) لإضافة mid-mission staging loop — هذا هو الاستثناء الوحيد المطلوب.
4. **اختبارات deterministic كاملة قبل المهمة الحية** — لا انتقال للمهمة الحية إلا بعد PASS كل اختبارات MemoryRuntime.
5. **مهمة حية واحدة فقط بعد اكتمال التكامل** للتأكد من أن العقود الثلاثة تعمل معاً تحت إنتاج حقيقي.

### ما أُؤكده بصدق:

- **لا أضمن أن المهمة الحية ستنجح.** حتى مع D+ كاملاً، Z.ai قد يُولّد `node --test test/` خطأ. لكن الـ gate سيُجبر العامل على اكتشاف وإصلاح هذا بنفسه قبل `finish`.
- **لا أضمن اختفاء duplicate-production بالكامل.** لكن الـ ownership + read-only enforcement سيُقللانه بشكل كبير.
- **أضمن أن النظام سيُبلغ عن الفشل بصدق.** هذا هو الضمان الأساسي — لا نجاح كاذب.

---

## 9. Closing

☕ "**حتى جلسة الشاي الهندسية يجب أن تنتهي يومًا ما بفتح الدكان وبيع أول منتج ناجح!**"

أنا جاهز لفتح الدكان. التصميم مكتمل. العقود الثلاثة محددة. المخاطر مُقيّمة بصدق. الاستثناءات الـ frozen محدودة في 30 LOC فقط.

**بانتظار قرار صاحب المشروع بالموافقة على:**

1. التصميم الكامل لـ D+ (§2)
2. التنفيذ على مرحلتين (§6)
3. استثناء frozen ضيق في `orchestrator.ts` (~30 LOC)

**بعد الموافقة، سنكتب مهمتين تنفيذيتين واضحتين بدل سلسلة إصلاحات مفتوحة.**

لا G7-19I، لا G7-20، لا مهمة حية حتى يصدر القرار.

**SMALL IN CODE. LARGE IN CAPABILITY.**

— GLM، جاهز لافتتاح الدكان مقابل مبنى OpenAI ☕😂
