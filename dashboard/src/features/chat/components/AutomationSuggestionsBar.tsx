import { Lightbulb } from "lucide-react";
import type { AutomationIdea } from "../types/automationIdeas";

export type AutomationSuggestionsBarProps = {
  ideas: AutomationIdea[];
  connectedIds: string[];
  onSelectIdea: (idea: AutomationIdea) => void;
  onMissingIntegrations: (idea: AutomationIdea) => void;
};

export function AutomationSuggestionsBar({
  ideas,
  connectedIds,
  onSelectIdea,
  onMissingIntegrations,
}: AutomationSuggestionsBarProps) {
  const handleClick = (idea: AutomationIdea) => {
    const lower = (s: string) => s.toLowerCase();
    const hasRequired = idea.required_integrations.every((id) =>
      connectedIds.some((c) => lower(c) === lower(id))
    );
    if (hasRequired) {
      onSelectIdea(idea);
    } else {
      onMissingIntegrations(idea);
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <Lightbulb className="size-3.5" aria-hidden />
        Try an idea
      </div>
      <div className="flex flex-wrap gap-2">
        {ideas.slice(0, 8).map((idea) => (
          <button
            key={idea.id}
            type="button"
            onClick={() => handleClick(idea)}
            className="border-input hover:bg-muted/50 flex min-w-0 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
          >
            <span className="truncate font-medium w-full">{idea.title}</span>
            <span className="text-muted-foreground line-clamp-1 text-xs font-normal w-full min-w-0">
              {idea.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
