"use client";

import { useState, useSyncExternalStore } from "react";
import { extractDeadlines, formatLong, formatShort, raciRows } from "@/lib/deadlines";
import { raciWorkbook } from "@/lib/raci-xlsx";
import {
  calendarIcs,
  mailtoHref,
  markReminderSent,
  meetingMinutes,
  parseParticipantEmails,
  readReminders,
  reminderMessage,
  saveReminders,
  subscribeReminders,
  validEmails,
} from "@/lib/minutes";
import type { Analysis } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function MinutesPanel({
  analysis,
  fileName,
  emails,
  meetingDate,
  today,
}: {
  analysis: Analysis;
  fileName: string;
  emails: string;
  meetingDate: string;
  today: string;
}) {
  const [notice, setNotice] = useState("");
  const saved = useSyncExternalStore(subscribeReminders, readReminders, () => []);
  const dated = Boolean(meetingDate);
  const deadlines = dated ? extractDeadlines(analysis.utterances, meetingDate) : [];
  const rows = raciRows(
    deadlines,
    analysis.speakers.map((speaker) => ({ name: speaker.name, role: speaker.role })),
  );
  const minutes = meetingMinutes(analysis, deadlines, meetingDate);
  const recipients = validEmails(emails);
  const parsed = parseParticipantEmails(emails);
  const due = today ? saved.filter((item) => !item.sent && item.remindOn <= today) : [];
  const subject = `Minutes: ${fileName || "Team meeting"}`;

  const openMail = (href: string, message: string) => {
    setNotice(message);
    const link = document.createElement("a");
    link.href = href;
    link.click();
  };

  const downloadCalendar = () => {
    saveReminders(deadlines, recipients);
    const blob = new Blob([calendarIcs(deadlines, parsed)], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "meeting-deadlines.ics";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Calendar file downloaded. Open it to add an alarm two days before each deadline.");
  };

  const downloadRaci = () => {
    const bytes = raciWorkbook(rows, today);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "raci-deadlines.xlsx";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Excel file downloaded. Open raci-deadlines.xlsx for the RACI table.");
  };

  return (
    <Card className="border-t-4 border-t-[var(--speaker-4)]">
      <CardHeader>
        <CardTitle>Minutes, decisions, and deadlines</CardTitle>
        <CardDescription>
          Email the minutes now. Each dated deadline can also remind the group two days before, through your mail app and calendar.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {due.length > 0 ? (
          <div className="grid gap-2 rounded-lg border border-border bg-[oklch(0.96_0.04_70)] px-3 py-3" role="status">
            <p className="font-medium">A reminder is due</p>
            {due.map((item) => (
              <div key={item.id} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                <p className="text-sm">
                  {item.owner}: {item.task} Due {formatLong(item.due)}.
                </p>
                <Button
                  type="button"
                  disabled={item.emails.length === 0}
                  onClick={() => {
                    openMail(
                      mailtoHref(item.emails, `Reminder: due ${formatLong(item.due)}`, reminderMessage(item)),
                      "Your mail app should open with the reminder. Send it from there.",
                    );
                    markReminderSent(item.id);
                  }}
                >
                  Email this reminder
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        <section className="grid min-w-0 gap-2" aria-labelledby="deadline-list">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="deadline-list" className="font-heading text-base">
              Deadlines from the discussion
            </h3>
            <Button type="button" variant="secondary" disabled={rows.length === 0} onClick={downloadRaci}>
              Export RACI to Excel
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            R is Responsible and does the work. A is Accountable and answers for it. C is Consulted and is asked. I is Informed and is told. The reminder is two days before the due date.
          </p>
          {dated ? null : (
            <p className="text-sm">Set the meeting date so “Thursday” or “tonight” becomes a calendar day.</p>
          )}
          {dated && deadlines.length === 0 ? (
            <p className="text-sm">No dated deadline was found. A line needs a day, such as Thursday, tonight, or October 30.</p>
          ) : null}
          {deadlines.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border focus-visible:outline-3" tabIndex={0}>
              <table className="w-full border-collapse text-left text-xs">
                <caption className="sr-only">
                  Deadlines with a short description, due date, reminder date, and RACI roles
                </caption>
                <thead className="bg-muted">
                  <tr>
                    <th scope="col" className="px-2 py-2 align-top font-medium">Description</th>
                    <th scope="col" className="px-2 py-2 align-top font-medium">Due</th>
                    <th scope="col" className="px-2 py-2 align-top font-medium">Reminder</th>
                    <th scope="col" className="px-2 py-2 align-top font-medium"><abbr title="Responsible">R</abbr></th>
                    <th scope="col" className="px-2 py-2 align-top font-medium"><abbr title="Accountable">A</abbr></th>
                    <th scope="col" className="px-2 py-2 align-top font-medium"><abbr title="Consulted">C</abbr></th>
                    <th scope="col" className="px-2 py-2 align-top font-medium"><abbr title="Informed">I</abbr></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.due}-${row.description}`} className="border-t border-border">
                      <th scope="row" className="px-2 py-2 align-top font-medium">{row.description}</th>
                      <td className="px-2 py-2 align-top">{formatShort(row.due)}</td>
                      <td className="px-2 py-2 align-top">
                        {formatShort(row.remindOn)}
                        {today && row.remindOn < today ? " · passed" : ""}
                      </td>
                      <td className="px-2 py-2 align-top">{row.responsible}</td>
                      <td className="px-2 py-2 align-top">{row.accountable}</td>
                      <td className="px-2 py-2 align-top">{row.consulted}</td>
                      <td className="px-2 py-2 align-top">{row.informed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <section className="grid gap-2" aria-labelledby="minutes-preview">
          <h3 id="minutes-preview" className="font-heading text-base">
            Minutes to send
          </h3>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-muted px-3 py-3 text-sm">{minutes}</pre>
          <p className="text-sm">
            {recipients.length > 0
              ? `To: ${recipients.join(", ")}`
              : "Add at least one valid email under Participant emails."}
          </p>
          {parsed.some((row) => !row.valid) ? (
            <p className="text-sm text-destructive" role="alert">
              Fix the addresses that are not emails before sending. Broken lines are skipped.
            </p>
          ) : null}
        </section>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={recipients.length === 0}
            onClick={() =>
              openMail(
                mailtoHref(recipients, subject, minutes),
                "Your mail app should open with the minutes. Send it from there.",
              )
            }
          >
            Email the minutes
          </Button>
          <Button type="button" variant="secondary" disabled={!dated || deadlines.length === 0} onClick={downloadCalendar}>
            Add reminders, 2 days before
          </Button>
        </div>
        {notice ? (
          <p className="text-sm" role="status">
            {notice}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          The minutes open in your own mail app, addressed to the participant emails. The calendar file puts an alarm on each deadline two days earlier and lists those emails as guests. Nothing is sent until you confirm it in Mail or Calendar.
        </p>
      </CardContent>
    </Card>
  );
}
