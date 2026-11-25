"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { ErrorNote } from "@/components/ui/states";
import { Notice } from "@/components/ui/status";
import { createClient } from "@/lib/supabase/client";
import { FORMATS, FORMAT_LABELS, hashtagCount, validateFiles, type Format } from "@/lib/posts/upload";
import { createDraft, discardDraft, finalizeDraft } from "../post-actions";

type Account = { id: string; username: string; require_approval: boolean };

export function UploadForm({ slug, accounts, defaultDate }: { slug: string; accounts: Account[]; defaultDate: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [format, setFormat] = useState<Format>("image");
  const [caption, setCaption] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [step, setStep] = useState("");

  const tags = hashtagCount(caption);

  function submit(form: HTMLFormElement) {
    setError(null);
    setDone(null);
    const fd = new FormData(form);
    const meta = files.map((f) => ({ name: f.name, type: f.type, size: f.size }));
    const fileError = validateFiles(format, meta);
    if (fileError) return setError(fileError);
    if (tags > 30) return setError("Use no máximo 30 hashtags.");

    start(async () => {
      setStep("Criando o post…");
      const draft = await createDraft(slug, {
        accountId: fd.get("accountId"),
        format,
        date: fd.get("date"),
        time: fd.get("time"),
        theme: fd.get("theme"),
        caption,
        files: meta,
      });
      if (!draft.ok) return setError(draft.error), setStep("");

      const supabase = createClient();
      for (let i = 0; i < files.length; i++) {
        setStep(`Enviando arquivo ${i + 1} de ${files.length}…`);
        const { error: upErr } = await supabase.storage.from("media").upload(draft.paths[i], files[i], { contentType: files[i].type });
        if (upErr) {
          await discardDraft(slug, draft.postId);
          setStep("");
          return setError(`Não foi possível enviar ${files[i].name}. Tente de novo.`);
        }
      }

      setStep("Agendando…");
      const fin = await finalizeDraft(slug, { postId: draft.postId, files: files.map((f, i) => ({ path: draft.paths[i], type: f.type })) });
      setStep("");
      if (!fin.ok) {
        await discardDraft(slug, draft.postId);
        return setError(fin.error);
      }
      setDone(fin.status === "pending_approval" ? "Post enviado para aprovação." : "Post agendado.");
      form.reset();
      setFiles([]);
      setCaption("");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
      className="flex flex-col gap-4 rounded-lg border border-border p-5"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="files" className="text-[13px] font-medium text-text-2">
          Selecione fotos, vídeos ou artes prontas
        </label>
        <input
          id="files"
          type="file"
          multiple={format === "carousel"}
          accept="image/jpeg,image/png,video/mp4,video/quicktime"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="rounded-md border border-dashed border-border-strong bg-subtle px-3 py-6 text-[14px] file:mr-3 file:h-9 file:rounded-md file:border-0 file:bg-primary file:px-3 file:font-semibold file:text-on-primary"
        />
        <p className="text-[13px] text-muted-fg">JPG, PNG, MP4 ou MOV. Para carrossel, até 10 arquivos.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="Conta" htmlFor="accountId">
          <Select id="accountId" name="accountId" required>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.username} · {a.require_approval ? "pede aprovação" : "publica direto"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Formato" htmlFor="format">
          <Select id="format" value={format} onChange={(e) => setFormat(e.target.value as Format)}>
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABELS[f]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Data" htmlFor="date">
          <Input id="date" name="date" type="date" required defaultValue={defaultDate} />
        </Field>
        <Field label="Horário" htmlFor="time">
          <Input id="time" name="time" type="time" required defaultValue="18:00" />
        </Field>
      </div>

      <Field label="Tema" htmlFor="theme">
        <Input id="theme" name="theme" required maxLength={120} placeholder="Ex.: como reduzir faltas em consultas" />
      </Field>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="caption" className="text-[13px] font-medium text-text-2">
          Legenda
        </label>
        <textarea
          id="caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          maxLength={2200}
          rows={5}
          disabled={format === "story"}
          placeholder={format === "story" ? "Stories não têm legenda." : ""}
          className="rounded-md border border-border-strong px-3 py-2 text-[14px] disabled:bg-muted"
        />
        <p className="text-[13px] tabular-nums text-muted-fg">
          {caption.length.toLocaleString("pt-BR")} / 2.200 caracteres · {tags} / 30 hashtags
        </p>
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {done ? <Notice tone="success">{done}</Notice> : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? step || "Enviando…" : "Agendar"}
        </Button>
      </div>
    </form>
  );
}
