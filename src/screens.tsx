import React, { useEffect, useState } from "react";
import { Routes, Route, Link } from "react-router";
import { useAction, useAppClient, ConnectionSettings, ConsentScreen, PendingSaves, Modal, Button, Form, ViewCard } from "@app-builder/core/react";
import { appConfig } from "../app.config";

import type { books } from "./schema";
type Book = typeof books.$inferSelect;

const labels = { reading: "Reading", "want-to-read": "Want to read", finished: "Finished" };
export function Library() {
  const client = useAppClient();
  const { data: books = [], loading, error, refresh } = useAction<Book[]>("list_books");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Book | null>(null);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => () => client.select(null), [client.select]);
  const visible = books.filter((book) => (filter === "all" || book.status === filter) && `${book.title} ${book.author}`.toLowerCase().includes(query.toLowerCase()));
  const select = (book: Book | null) => { setSelected(book); client.select(book ? { id: book.id, title: book.title } : null); };
  return <div className="workspace">
    <header className="app-header"><Link to="/" className="brand"><span className="brand-mark" aria-hidden="true">▥</span>{appConfig.name}</Link>{!client.embedded && <Link className="settings-link" to="/settings">Settings</Link>}</header>
    <main className="library">
      <div className="page-heading"><div><p className="eyebrow">Your own little library</p><h1>Keep the good ones.</h1><p className="subtitle">Books you’re reading, books you loved, and what comes next.</p></div><Button className="primary" onClick={() => setAdding(true)}>＋ Add a book</Button></div>
      <PendingSaves /><div className="toolbar"><div className="tabs" aria-label="Reading status">{[["all", "All books"], ...Object.entries(labels)].map(([value, label]) => <button key={value} className={filter === value ? "tab active" : "tab"} onClick={() => setFilter(value)}>{label}<span>{books.filter((book) => value === "all" || book.status === value).length}</span></button>)}</div><input className="search" type="search" placeholder="Find a book…" aria-label="Find a book" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      {error && <p role="alert" className="error">{error} <button className="text-button" onClick={() => void refresh()}>Try again</button></p>}
      {loading ? <p className="empty">Opening your shelves…</p> : visible.length ? <div className="book-list">{visible.map((book, index) => <button className={selected?.id === book.id ? "book-row selected" : "book-row"} key={book.id} onClick={() => select(book)}>
        <span className={`book-cover cover-${index % 5}`} aria-hidden="true"><span>{book.title}</span><small>{book.author}</small></span>
        <span className="book-copy"><strong>{book.title}</strong><span>{book.author || "Author unknown"}</span>{book.note && <p>{book.note}</p>}</span>
        <span className={`status status-${book.status}`}>{labels[book.status]}</span><span className="row-arrow" aria-hidden="true">↗</span>
      </button>)}</div> : <div className="empty-state"><span className="empty-book" aria-hidden="true">▥</span><h2>{query ? "No books found." : "Your next chapter starts here."}</h2><p>{query ? "Try another title or author." : "Add your first book, then leave a note worth coming back to."}</p>{!query && <Button className="primary" onClick={() => setAdding(true)}>Add your first book</Button>}</div>}
      <footer className="library-footer"><span>{books.length} {books.length === 1 ? "book" : "books"} in your library</span><span>{client.localOwner ? "Saved on this computer" : "Your private collection"}</span></footer>
    </main>
    {selected && <aside className="detail-panel"><button className="close" aria-label="Close book" onClick={() => select(null)}>×</button><p className="eyebrow">From your library</p><h2>{selected.title}</h2><p className="detail-author">{selected.author}</p><label>Reading status<select value={selected.status} onChange={async (event) => {
      try { const updated = await client.call<Book>("update_book", { ...selected, expectedUpdatedAt: selected.updatedAt, status: event.target.value }); select(updated); client.didChange(`Marked “${updated.title}” as ${labels[updated.status].toLowerCase()}`); await refresh(); }
      catch (error) { setSaveError((error as Error).message); }
    }}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <Form onSubmit={async (form) => {
        setBusy(true); setSaveError("");
        try { const updated = await client.call<Book>("update_book", { ...selected, note: form.get("note"), expectedUpdatedAt: selected.updatedAt }); select(updated); client.didChange(`Updated the note on “${updated.title}”`); await refresh(); }
        catch (error) { setSaveError((error as Error).message); } finally { setBusy(false); }
      }} key={selected.updatedAt}><label>Your notes<textarea name="note" rows={8} defaultValue={selected.note} placeholder="A passage, a thought, a reason to remember…" /></label>{saveError && <p role="alert" className="error">{saveError}</p>}<Button className="primary" disabled={busy}>{busy ? "Saving…" : "Save note"}</Button></Form>
    </aside>}
    {adding && <Modal open={adding} onOpenChange={setAdding} title="Add a book"><Form onSubmit={async (form) => {
      setBusy(true); setSaveError("");
      try {
        await client.save("save_book", { id: crypto.randomUUID(), title: form.get("title"), author: form.get("author"), status: form.get("status"), note: form.get("note") });
        client.didChange(`Added “${String(form.get("title"))}”`);
        setAdding(false); await refresh();
      } catch (error) { setSaveError((error as Error).message); } finally { setBusy(false); }
    }}><label>Title<input name="title" required maxLength={240} autoFocus placeholder="The book on your mind" /></label><label>Author<input name="author" maxLength={160} placeholder="Who wrote it?" /></label><label>Status<select name="status" defaultValue="want-to-read">{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>A note<textarea name="note" rows={3} placeholder="Optional. What drew you to this book?" /></label>{saveError && <p role="alert" className="error">{saveError}</p>}<Button className="primary" disabled={busy}>{busy ? "Saving…" : "Add to library"}</Button></Form></Modal>}
  </div>;
}

/** The card show_books draws in a chat: the books it named, each one's status changeable in place. */
export function BooksCard({ data }: { data: { title: string; books: Book[]; more: boolean } }) {
  const client = useAppClient();
  const [items, setItems] = useState(data.books);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { setItems(data.books); }, [data.books]);
  useEffect(() => () => client.select(null), [client.select]);
  return <ViewCard title={data.title} count={items.length ? `${items.length}${data.more ? "+" : ""}` : undefined} footer={data.more ? `More in your ${client.config.name}.` : undefined}>
    {error && <p role="alert" className="error">{error}</p>}
    {items.length ? <ul className="view-list">{items.map((book, index) => <li key={book.id} className={busy === book.id ? "view-row busy" : "view-row"}>
      <span className={`book-cover mini cover-${index % 5}`} aria-hidden="true" />
      <button type="button" className="view-row-body" onClick={() => client.select({ id: book.id, title: book.title })}><strong>{book.title}</strong><span>{book.author || "Author unknown"}</span></button>
      <select aria-label={`Status of ${book.title}`} value={book.status} disabled={busy === book.id} onChange={async (event) => {
        setBusy(book.id); setError("");
        try {
          const updated = await client.call<Book>("update_book", { ...book, expectedUpdatedAt: book.updatedAt, status: event.target.value });
          setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
          client.didChange(`Marked “${updated.title}” as ${labels[updated.status].toLowerCase()}`);
        } catch (error) { setError((error as Error).message); } finally { setBusy(""); }
      }}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    </li>)}</ul> : <p className="view-empty">No books match.</p>}
  </ViewCard>;
}
/** Cards for the app's show_* tools. Anything else in an assistant draws the whole app. */
export const viewCards = { show_books: BooksCard };

export function AppScreens() { return <Routes><Route path="/" element={<Library />} /><Route path="/settings" element={<ConnectionSettings />} /><Route path="/oauth/consent" element={<ConsentScreen />} /><Route path="*" element={<Library />} /></Routes>; }
