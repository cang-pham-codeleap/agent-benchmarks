# Component Guidelines for Agent Benchmarks Views

This guide establishes the conventions for views using **Tailwind v4** and vendored **shadcn/ui** components.

## Golden Rule

**Use Tailwind utilities and existing semantic tokens; do not add custom palettes.**
Use the primitives vendored under `@/components/ui/` (`src/ui/components/ui/`).

---

## 1. Primitives Inventory (`@/components/ui/`)

| UI Need                             | Primitive to Use                                                                 | Import Path                     |
| ----------------------------------- | -------------------------------------------------------------------------------- | ------------------------------- |
| Buttons, icon triggers, CTA         | `Button`, `buttonVariants`                                                       | `@/components/ui/button`        |
| Cards, grouped panels, metric tiles | `Card`, `CardHeader`, `CardTitle`, `CardContent`, `CardFooter`                   | `@/components/ui/card`          |
| Status tags, pills, source tags     | `Badge` (from `@/components/ui/badge` or `@/badges` for domain badges)           | `@/components/ui/badge`         |
| Data tables, session lists          | `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`        | `@/components/ui/table`         |
| Inputs, search fields               | `Input`                                                                          | `@/components/ui/input`         |
| Dropdowns, selects                  | `Select`, `SelectTrigger`, `SelectContent`, `SelectItem`                         | `@/components/ui/select`        |
| Filter toggles, checkboxes          | `Checkbox`                                                                       | `@/components/ui/checkbox`      |
| Menus, context menus                | `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem` | `@/components/ui/dropdown-menu` |
| Flyouts, anchored popovers          | `Popover`, `PopoverTrigger`, `PopoverContent`                                    | `@/components/ui/popover`       |
| Hover help, hints                   | `Tooltip`, `TooltipTrigger`, `TooltipContent`                                    | `@/components/ui/tooltip`       |
| Segmented controls, view tabs       | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`                                 | `@/components/ui/tabs`          |
| Visual dividers                     | `Separator`                                                                      | `@/components/ui/separator`     |
| Placeholders, loading states        | `Skeleton`                                                                       | `@/components/ui/skeleton`      |
| Scroll containers                   | `ScrollArea`, `ScrollBar`                                                        | `@/components/ui/scroll-area`   |
| Drawers, slide-out panels           | `Sheet`, `SheetTrigger`, `SheetContent`, `SheetHeader`, `SheetTitle`             | `@/components/ui/sheet`         |
| Modals, confirmation dialogs        | `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`        | `@/components/ui/dialog`        |
| Command palette, quick jump         | `Command`, `CommandInput`, `CommandList`, `CommandItem`                          | `@/components/ui/command`       |
| App shell sidebar                   | `Sidebar`, `SidebarHeader`, `SidebarContent`, `SidebarFooter`                    | `@/components/ui/sidebar`       |
| Disclosures, accordion items        | `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent`                        | `@/components/ui/collapsible`   |
| Grouped toggles                     | `ToggleGroup`, `ToggleGroupItem`                                                 | `@/components/ui/toggle-group`  |
| Form labels                         | `Label`                                                                          | `@/components/ui/label`         |
| Warnings, banners, error notices    | `Alert`, `AlertTitle`, `AlertDescription`                                        | `@/components/ui/alert`         |

---

## 2. Spacing Scale & Layout Conventions

Use standard Tailwind spacing units (multiples of 4px / 0.25rem):

- **Page containers**:

  ```tsx
  <div className="flex flex-col gap-6 p-6">
  ```
- **Page header pattern**:

  ```tsx
  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Page Title</h1>
      <p className="text-sm text-muted-foreground">Short description of this view.</p>
    </div>
    <div className="flex items-center gap-2">
      {/* Controls: DateRange, SourceFilter, Actions */}
    </div>
  </div>
  ```
- **Stat grid pattern**:

  ```tsx
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
    {/* StatCard or Card components */}
  </div>
  ```
- **Table pattern**:
  Wrap all tabular displays in a bordered card container:

  ```tsx
  <div className="rounded-md border">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Session</TableHead>
          <TableHead>Model</TableHead>
          <TableHead className="text-right">Tokens</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">Title</TableCell>
          <TableCell>Claude</TableCell>
          <TableCell className="text-right font-mono text-xs">12.5k</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
  ```

---

## 3. Dark Mode & Colors

- Theme switching works via the `.dark` class applied to `<html>` and data-theme.
- **Never use hard-coded hex or rgb colors** in Tailwind classes (avoid `bg-[#1a1a1a]`, `text-[#ffffff]`).
- Use semantic token utilities:
  - Backgrounds: `bg-background`, `bg-card`, `bg-muted`, `bg-accent`
  - Foregrounds: `text-foreground`, `text-muted-foreground`, `text-primary`
  - Borders: `border-border`, `border-input`
  - Feedback: `text-destructive`, `bg-destructive/10`, `border-destructive/20`

## 4. Typography

- Inter is the only UI font and is vendored locally for offline use.
- Use `font-sans` for all prose and UI labels.
- Reserve `font-mono` for code, keyboard shortcuts, and transcripts.
- Page titles use `text-2xl font-semibold tracking-tight`; descriptions use `text-sm text-muted-foreground`.
