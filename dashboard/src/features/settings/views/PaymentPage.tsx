import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  fetchChannelsStripe,
  updateChannelsStripe,
  type StripeChannelState,
} from "@/lib/api";
import { ExternalLink } from "lucide-react";

const STRIPE_DASHBOARD = "https://dashboard.stripe.com/apikeys";

export function PaymentPage() {
  const [stripeState, setStripeState] = useState<StripeChannelState | null>(null);
  const [stripeSecretKey, setStripeSecretKey] = useState("");
  const [stripeSaving, setStripeSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchChannelsStripe();
      setStripeState(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSaveStripe = async () => {
    setStripeSaving(true);
    setError(null);
    try {
      const data = await updateChannelsStripe({
        secretKey: stripeSecretKey.trim() || null,
      });
      setStripeState(data);
      setStripeSecretKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStripeSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-sm">Loading payment settings…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stripe</CardTitle>
          <CardDescription>
            Let the agent list customers and invoices, and create invoices. Paste your Stripe Secret Key (from Dashboard → API keys). Use test key (sk_test_…) for development.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {stripeState && (
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Status:</span>
                {stripeState.configured ? (
                  <span className="text-green-600 dark:text-green-400">Configured</span>
                ) : (
                  <span className="text-muted-foreground">Not configured</span>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="stripe-secret-key" className="text-sm font-medium">
              Secret key
            </label>
            <Input
              id="stripe-secret-key"
              type="password"
              placeholder={stripeState?.configured ? "(already set)" : "sk_test_… or sk_live_…"}
              value={stripeSecretKey}
              onChange={(e) => setStripeSecretKey(e.target.value)}
              autoComplete="off"
              className="font-mono text-sm"
            />
            <p className="text-muted-foreground text-xs">
              Get a key from Stripe Dashboard → Developers → API keys. Leave blank to keep the current key.
            </p>
          </div>

          <p className="text-muted-foreground text-xs">
            <a
              href={STRIPE_DASHBOARD}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Open Stripe API keys
              <ExternalLink className="size-3" />
            </a>
          </p>

          {error && (
            <p className="text-destructive text-sm">{error}</p>
          )}

          <Button onClick={handleSaveStripe} disabled={stripeSaving}>
            {stripeSaving ? "Saving…" : "Save"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
