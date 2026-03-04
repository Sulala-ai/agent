import { createContext, useContext } from "react";
import { ChevronRight, ChevronLeft, Puzzle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useSkillWizard, WIZARD_STEPS } from "../hooks/useSkillWizard";

const SkillWizardContext = createContext<ReturnType<typeof useSkillWizard> | null>(null);
function useSkillWizardContext() {
  const ctx = useContext(SkillWizardContext);
  if (!ctx) throw new Error("SkillWizardFlow must wrap steps");
  return ctx;
}

function Step1Goal() {
  const { state, setGoal, setStep } = useSkillWizardContext();
  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        Describe what you want this agent to do. For example: &quot;Summarize my important emails daily&quot; or &quot;Post updates to Slack when I deploy.&quot;
      </p>
      <div className="space-y-2">
        <Label htmlFor="wizard-goal">What should this skill do?</Label>
        <textarea
          id="wizard-goal"
          placeholder="e.g. Check Gmail and summarize important emails daily"
          value={state.goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={4}
          className={cn(
            "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] resize-none"
          )}
        />
      </div>
      <div className="flex justify-end">
        <Button onClick={() => setStep(1)} disabled={!state.goal.trim()}>
          Next
          <ChevronRight className="ml-1 size-4" />
        </Button>
      </div>
    </div>
  );
}

function Step2App() {
  const { state, setApp, setStep } = useSkillWizardContext();
  const apps = state.apps.length ? state.apps : [
    { id: "gmail", label: "Gmail", envHint: "API key or connect later" },
    { id: "slack", label: "Slack", envHint: "Token or connect later" },
    { id: "notion", label: "Notion", envHint: "API key or connect later" },
    { id: "github", label: "GitHub", envHint: "Token or connect later" },
    { id: "calendar", label: "Google Calendar", envHint: "Credentials or connect later" },
    { id: "webhook", label: "Webhook", envHint: "Optional" },
    { id: "other", label: "Other", envHint: "Depends on skill" },
  ];
  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        Choose the app or service this skill will use. You can add API keys or connect the app later on the Skills page.
      </p>
      <div className="grid gap-2">
        {apps.map((a) => (
          <label
            key={a.id}
            className={`border-input flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 ${
              state.app === a.id ? "border-primary bg-muted/50" : ""
            }`}
          >
            <input
              type="radio"
              name="wizard-app"
              value={a.id}
              checked={state.app === a.id}
              onChange={() => setApp(a.id)}
              className="size-4"
            />
            <div className="flex-1">
              <span className="font-medium">{a.label}</span>
              <span className="text-muted-foreground ml-2 text-xs">({a.envHint})</span>
            </div>
          </label>
        ))}
      </div>
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep(0)}>
          <ChevronLeft className="mr-1 size-4" />
          Back
        </Button>
        <Button onClick={() => setStep(2)}>
          Next
          <ChevronRight className="ml-1 size-4" />
        </Button>
      </div>
    </div>
  );
}

function Step3Trigger() {
  const { state, setTrigger, setStep, generatePreview } = useSkillWizardContext();
  const triggers = state.triggers.length ? state.triggers : [
    { id: "manual", label: "When I ask (manual)" },
    { id: "schedule", label: "On a schedule (cron)" },
    { id: "webhook", label: "When a webhook is called" },
    { id: "message", label: "When I send a message (e.g. Telegram)" },
  ];
  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        When should this skill run? You can configure schedules or webhooks later in Jobs.
      </p>
      <div className="grid gap-2">
        {triggers.map((t) => (
          <label
            key={t.id}
            className={`border-input flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 ${
              state.trigger === t.id ? "border-primary bg-muted/50" : ""
            }`}
          >
            <input
              type="radio"
              name="wizard-trigger"
              value={t.id}
              checked={state.trigger === t.id}
              onChange={() => setTrigger(t.id)}
              className="size-4"
            />
            <span className="font-medium">{t.label}</span>
          </label>
        ))}
      </div>
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep(1)}>
          <ChevronLeft className="mr-1 size-4" />
          Back
        </Button>
        <Button
          onClick={async () => {
            await generatePreview();
            setStep(3);
          }}
          disabled={state.loading}
        >
          {state.loading ? "Generating…" : "Review"}
          <ChevronRight className="ml-1 size-4" />
        </Button>
      </div>
    </div>
  );
}

function Step4Review() {
  const { state, setStep, createSkill } = useSkillWizardContext();
  const spec = state.spec;

  const handleCreate = async () => {
    const result = await createSkill();
    if (result?.written) return; // onSuccess will close dialog
  };

  if (!spec && !state.loading) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">Preview not loaded. Go back and click Review again.</p>
        <Button variant="outline" onClick={() => setStep(2)}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {spec && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
          <div className="font-medium">{spec.name}</div>
          <p className="text-muted-foreground text-sm">{spec.description}</p>
          <div className="text-muted-foreground text-xs">
            Slug: <code className="rounded bg-muted px-1">{spec.slug}</code>
            {spec.requiredEnv.length > 0 && (
              <> · Required: {spec.requiredEnv.join(", ")}</>
            )}
          </div>
        </div>
      )}
      <p className="text-muted-foreground text-sm">
        Click Create to add this skill to your workspace. You can then enable it and add API keys (or connect the app) on the Skills page.
      </p>
      {state.error && (
        <p className="text-destructive text-sm">{state.error}</p>
      )}
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep(2)}>
          <ChevronLeft className="mr-1 size-4" />
          Back
        </Button>
        <Button onClick={handleCreate} disabled={state.loading}>
          {state.loading ? "Creating…" : "Create skill"}
        </Button>
      </div>
    </div>
  );
}

type SkillWizardFlowProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

export function SkillWizardFlow({ open, onOpenChange, onSuccess }: SkillWizardFlowProps) {
  const wizard = useSkillWizard(() => {
    onSuccess?.();
    onOpenChange(false);
    wizard.reset();
  });
  const { state } = wizard;
  const current = Math.max(0, Math.min(state.step, WIZARD_STEPS.length - 1));

  return (
    <SkillWizardContext.Provider value={wizard}>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-full max-w-lg sm:max-w-xl" showCloseButton>
          <DialogHeader className="space-y-2 pb-4 border-b">
            <div className="flex items-center gap-2">
              <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
                <Puzzle className="size-5" />
              </span>
              <div>
                <DialogTitle>Create a skill</DialogTitle>
                <DialogDescription>
                  Step {current + 1} of {WIZARD_STEPS.length}: {WIZARD_STEPS[current]}
                </DialogDescription>
              </div>
            </div>
            <Progress value={((current + 1) / WIZARD_STEPS.length) * 100} className="h-2" />
          </DialogHeader>
          <div className="pt-4">
            {state.error && (
              <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {state.error}
              </div>
            )}
            {current === 0 && <Step1Goal />}
            {current === 1 && <Step2App />}
            {current === 2 && <Step3Trigger />}
            {current === 3 && <Step4Review />}
          </div>
        </DialogContent>
      </Dialog>
    </SkillWizardContext.Provider>
  );
}
