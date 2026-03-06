import type { AutomationIdea } from "../types/automationIdeas";
import { AUTOMATION_IDEAS } from "../types/automationIdeas";

export type AutomationSuggestionsBarProps = {
  connectedIds: string[];
  onSelectIdea: (idea: AutomationIdea) => void;
  onMissingIntegrations: (idea: AutomationIdea) => void;
};

export function AutomationSuggestionsBar({
  connectedIds,
  onSelectIdea,
  onMissingIntegrations,
}: AutomationSuggestionsBarProps) {
  const handleClick = (idea: AutomationIdea) => {
    onSelectIdea(idea);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-muted-foreground text-xs font-medium">Automation ideas</p>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin w-3/4">
        {AUTOMATION_IDEAS.map((idea) => (
          <button
            key={idea.id}
            type="button"
            onClick={() => handleClick(idea)}
            className="border-input bg-muted/30 hover:bg-muted/50 flex shrink-0 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors min-w-[180px] max-w-[220px]"
          >
            <span className="font-medium">{idea.title}</span>
            <span className="text-muted-foreground line-clamp-2 text-xs">{idea.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
