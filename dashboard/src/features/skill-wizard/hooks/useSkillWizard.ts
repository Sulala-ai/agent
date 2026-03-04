import { useState, useCallback, useEffect } from "react";
import {
  fetchAgentSkillWizardApps,
  fetchAgentSkillGenerate,
  type SkillWizardApp,
  type SkillWizardTrigger,
  type SkillSpec,
} from "@/lib/api";

export const WIZARD_STEPS = [
  "What should this skill do?",
  "Which app to connect?",
  "When should it run?",
  "Review & create",
];

export type SkillWizardState = {
  step: number;
  goal: string;
  app: string;
  trigger: string;
  apps: SkillWizardApp[];
  triggers: SkillWizardTrigger[];
  spec: SkillSpec | null;
  loading: boolean;
  error: string | null;
};

export function useSkillWizard(onSuccess?: () => void) {
  const [state, setState] = useState<SkillWizardState>({
    step: 0,
    goal: "",
    app: "other",
    trigger: "manual",
    apps: [],
    triggers: [],
    spec: null,
    loading: false,
    error: null,
  });

  const loadApps = useCallback(async () => {
    try {
      const { apps, triggers } = await fetchAgentSkillWizardApps();
      setState((s) => ({ ...s, apps, triggers }));
    } catch (e) {
      setState((s) => ({
        ...s,
        error: e instanceof Error ? e.message : "Failed to load options",
      }));
    }
  }, []);

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  const setStep = useCallback((step: number) => {
    setState((s) => ({ ...s, step: Math.max(0, Math.min(step, WIZARD_STEPS.length - 1)), error: null }));
  }, []);

  const setGoal = useCallback((goal: string) => {
    setState((s) => ({ ...s, goal }));
  }, []);

  const setApp = useCallback((app: string) => {
    setState((s) => ({ ...s, app }));
  }, []);

  const setTrigger = useCallback((trigger: string) => {
    setState((s) => ({ ...s, trigger }));
  }, []);

  const generatePreview = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { spec } = await fetchAgentSkillGenerate({
        goal: state.goal,
        app: state.app,
        trigger: state.trigger,
        write: false,
      });
      setState((s) => ({ ...s, spec, loading: false }));
      return spec;
    } catch (e) {
      setState((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : "Failed to generate preview",
      }));
      return null;
    }
  }, [state.goal, state.app, state.trigger]);

  const createSkill = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const result = await fetchAgentSkillGenerate({
        goal: state.goal,
        app: state.app,
        trigger: state.trigger,
        write: true,
      });
      setState((s) => ({ ...s, loading: false }));
      onSuccess?.();
      return result;
    } catch (e) {
      setState((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : "Failed to create skill",
      }));
      return null;
    }
  }, [state.goal, state.app, state.trigger, onSuccess]);

  const reset = useCallback(() => {
    setState({
      step: 0,
      goal: "",
      app: "other",
      trigger: "manual",
      apps: state.apps,
      triggers: state.triggers,
      spec: null,
      loading: false,
      error: null,
    });
  }, [state.apps, state.triggers]);

  return {
    state,
    setStep,
    setGoal,
    setApp,
    setTrigger,
    generatePreview,
    createSkill,
    loadApps,
    reset,
  };
}
