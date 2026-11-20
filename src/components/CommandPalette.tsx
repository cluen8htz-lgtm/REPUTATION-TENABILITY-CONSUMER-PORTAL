import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { BookOpen, BriefcaseBusiness, CalendarPlus, Car, Download, FileText, LayoutDashboard, PhoneCall, TriangleAlert, UserRound } from "lucide-react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";

const PAGES = [
  { to: "/portal", label: "Overview", icon: LayoutDashboard },
  { to: "/portal/billing-error", label: "Billing error (FCBA)", icon: TriangleAlert },
  { to: "/portal/repossession", label: "Repossession", icon: Car },
  { to: "/portal/documents", label: "Documents", icon: FileText },
  { to: "/portal/cases", label: "Court cases", icon: BriefcaseBusiness },
  { to: "/portal/calls", label: "Call log", icon: PhoneCall },
  { to: "/portal/intake", label: "My intake", icon: UserRound },
  { to: "/portal/learn", label: "Learn", icon: BookOpen },
];

/** ⌘K / Ctrl+K quick navigation and actions. */
export function CommandPalette({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen((v) => !v); }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("open-command-palette", onOpen); };
  }, []);
  const go = (to: string) => { setOpen(false); navigate(to); };
  const download = (href: string) => { setOpen(false); window.location.href = href; };
  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search the workspace" description="Jump to a page or run an action">
      <CommandInput placeholder="Type a page or action…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Go to">
          {PAGES.map(({ to, label, icon: Icon }) => <CommandItem key={to} onSelect={() => go(to)}><Icon />{label}</CommandItem>)}
          {isAdmin && <CommandItem onSelect={() => go("/portal/admin")}><UserRound />Staff review</CommandItem>}
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => download("/api/bundles/fcba.zip")}><Download />Download FCBA exhibit bundle<CommandShortcut>.zip</CommandShortcut></CommandItem>
          <CommandItem onSelect={() => download("/api/calendar/deadlines.ics")}><CalendarPlus />Add all deadlines to my calendar<CommandShortcut>.ics</CommandShortcut></CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
