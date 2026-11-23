import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AugmentPoolEntry, AugmentVerdict, AugmentVerdictKind } from "../../../eval/types.ts";
import { durationPrecise } from "../../format.ts";

const VERDICT: Record<
  AugmentVerdictKind,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  adopt: { label: "Adopt", variant: "default" },
  "quality-risk": { label: "Quality risk", variant: "destructive" },
  "no-saving": { label: "No saving", variant: "secondary" },
  inconclusive: { label: "Inconclusive", variant: "outline" },
};

const signed = (value: number, unit: string) =>
  `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}${unit}`;

type Row = Pick<
  AugmentVerdict,
  | "augments"
  | "config"
  | "verdict"
  | "pairs"
  | "passDelta"
  | "better"
  | "worse"
  | "tokenDelta"
  | "costDelta"
  | "savingBasis"
  | "prepMs"
  | "reason"
>;

function Saving({ row }: { row: Row }) {
  const value = row.savingBasis === "cost" ? row.costDelta : row.tokenDelta;
  if (row.savingBasis == null || value == null) return <>n/a</>;
  return (
    <>
      {signed(value, "%")}
      <span className="block text-xs text-muted-foreground">{row.savingBasis}</span>
    </>
  );
}

function VerdictBadge({ verdict }: { verdict: AugmentVerdictKind }) {
  return <Badge variant={VERDICT[verdict].variant}>{VERDICT[verdict].label}</Badge>;
}

const augmentSet = (row: Pick<Row, "config" | "augments">) =>
  `${row.config} +${row.augments.join(" +")}`;

function Scroll({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section
      className="overflow-x-auto rounded-md border"
      aria-label={label}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable scroll container so keyboard users can scroll the table
      tabIndex={0}
    >
      {children}
    </section>
  );
}

export function AugmentVerdictTable({ verdicts }: { verdicts: AugmentVerdict[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Augments</CardTitle>
        <CardDescription>Each augmented setup against its same-config baseline.</CardDescription>
      </CardHeader>
      <CardContent>
        <Scroll label="Augment verdicts">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Augment set</TableHead>
                <TableHead>Verdict</TableHead>
                <TableHead>Pairs</TableHead>
                <TableHead>Pass Δ</TableHead>
                <TableHead>Cost or token Δ</TableHead>
                <TableHead>Better / worse</TableHead>
                <TableHead>Prep</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {verdicts.map((row) => (
                <TableRow key={row.augmented}>
                  <TableCell>
                    {row.harness} · {row.model}
                    <span className="block text-xs text-muted-foreground">{augmentSet(row)}</span>
                  </TableCell>
                  <TableCell>
                    <VerdictBadge verdict={row.verdict} />
                  </TableCell>
                  <TableCell>{row.pairs}</TableCell>
                  <TableCell>
                    {row.passDelta == null ? "n/a" : signed(row.passDelta, " pts")}
                  </TableCell>
                  <TableCell>
                    <Saving row={row} />
                  </TableCell>
                  <TableCell>
                    {row.better} / {row.worse}
                  </TableCell>
                  <TableCell>{durationPrecise(row.prepMs)}</TableCell>
                  <TableCell className="max-w-sm whitespace-normal">{row.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Scroll>
      </CardContent>
    </Card>
  );
}

export function AugmentPoolPanel({ entries }: { entries: AugmentPoolEntry[] }) {
  if (entries.length === 0) return null;
  const groups = Map.groupBy(entries, (entry) => `${entry.harness} · ${entry.model}`);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Augment recommendations</CardTitle>
        <CardDescription>Pooled across runs by harness version, model, and config.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {[...groups].map(([group, rows]) => (
          <section key={group} className="space-y-2" aria-label={group}>
            <h3 className="font-semibold">{group}</h3>
            <Scroll label={`Augment recommendations for ${group}`}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Augment set</TableHead>
                    <TableHead>Verdict</TableHead>
                    <TableHead>Pairs</TableHead>
                    <TableHead>Pass Δ</TableHead>
                    <TableHead>Cost or token Δ</TableHead>
                    <TableHead>Harness version</TableHead>
                    <TableHead>Runs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={`${row.harnessVersion}/${augmentSet(row)}`}>
                      <TableCell>{augmentSet(row)}</TableCell>
                      <TableCell className="space-x-2">
                        <VerdictBadge verdict={row.verdict} />
                        {row.recipeDrift && (
                          <Badge
                            variant="outline"
                            title="These runs used different versions of an augment definition; the verdict pools them anyway."
                          >
                            recipe drift
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{row.pairs}</TableCell>
                      <TableCell>
                        {row.passDelta == null ? "n/a" : signed(row.passDelta, " pts")}
                      </TableCell>
                      <TableCell>
                        <Saving row={row} />
                      </TableCell>
                      <TableCell>{row.harnessVersion ?? "unknown"}</TableCell>
                      <TableCell>{row.runIds.length}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Scroll>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
