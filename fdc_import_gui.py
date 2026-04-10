import datetime
import queue
import threading
import tkinter as tk
from dataclasses import dataclass
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import Optional

import mysql.connector

from import_fdc_to_mysql import (
    ImportCallbacks,
    ImportCancelled,
    ImportOptions,
    get_load_table_order,
    get_table_csv_path,
    run_import,
)


@dataclass
class UiState:
    import_thread: Optional[threading.Thread] = None
    cancel_event: Optional[threading.Event] = None
    log_file: Optional[Path] = None


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("FDC MySQL Importer")
        self.geometry("1100x700")

        self._queue = queue.Queue()
        self._state = UiState()

        self._host_var = tk.StringVar(value="127.0.0.1")
        self._port_var = tk.StringVar(value="3306")
        self._user_var = tk.StringVar(value="root")
        self._password_var = tk.StringVar(value="")
        self._database_var = tk.StringVar(value="fooddb")
        self._dataset_dir_var = tk.StringVar(
            value=str(Path(__file__).resolve().parent)
        )

        self._create_tables_var = tk.BooleanVar(value=True)
        self._truncate_var = tk.BooleanVar(value=False)
        self._load_data_var = tk.BooleanVar(value=True)
        self._create_indexes_var = tk.BooleanVar(value=True)

        self._status_var = tk.StringVar(value="Idle")
        self._progress_text_var = tk.StringVar(value="")

        self._table_totals: dict[str, int] = {}
        self._table_loaded: dict[str, int] = {}

        self._build_ui()
        self.after(100, self._poll_queue)

    def _build_ui(self):
        top = ttk.Frame(self)
        top.pack(fill=tk.X, padx=10, pady=10)

        conn_frame = ttk.LabelFrame(top, text="Connection")
        conn_frame.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 10))

        self._grid_label_entry(conn_frame, 0, "Host", self._host_var)
        self._grid_label_entry(conn_frame, 1, "Port", self._port_var)
        self._grid_label_entry(conn_frame, 2, "User", self._user_var)

        ttk.Label(conn_frame, text="Password").grid(
            row=3,
            column=0,
            sticky="w",
            padx=6,
            pady=4,
        )
        pw = ttk.Entry(conn_frame, textvariable=self._password_var, show="*")
        pw.grid(row=3, column=1, sticky="ew", padx=6, pady=4)

        self._grid_label_entry(conn_frame, 4, "Database", self._database_var)

        conn_frame.columnconfigure(1, weight=1)

        btns = ttk.Frame(conn_frame)
        btns.grid(
            row=5,
            column=0,
            columnspan=2,
            sticky="w",
            padx=6,
            pady=(6, 0),
        )

        ttk.Button(
            btns,
            text="Test Connection",
            command=self._test_connection,
        ).pack(side=tk.LEFT)
        ttk.Button(
            btns,
            text="Open Log File",
            command=self._open_log_file,
        ).pack(side=tk.LEFT, padx=(8, 0))

        data_frame = ttk.LabelFrame(top, text="Dataset")
        data_frame.pack(side=tk.LEFT, fill=tk.X, expand=True)

        ttk.Label(data_frame, text="Dataset Folder").grid(
            row=0,
            column=0,
            sticky="w",
            padx=6,
            pady=4,
        )
        ds_entry = ttk.Entry(data_frame, textvariable=self._dataset_dir_var)
        ds_entry.grid(row=0, column=1, sticky="ew", padx=6, pady=4)
        ttk.Button(
            data_frame,
            text="Browse...",
            command=self._browse_dataset_dir,
        ).grid(
            row=0,
            column=2,
            sticky="e",
            padx=6,
            pady=4,
        )

        opts = ttk.Frame(data_frame)
        opts.grid(row=1, column=0, columnspan=3, sticky="w", padx=6, pady=(6, 0))

        ttk.Checkbutton(
            opts,
            text="Create tables",
            variable=self._create_tables_var,
        ).pack(side=tk.LEFT)
        ttk.Checkbutton(
            opts,
            text="Truncate existing",
            variable=self._truncate_var,
        ).pack(side=tk.LEFT, padx=(10, 0))
        ttk.Checkbutton(
            opts,
            text="Load data",
            variable=self._load_data_var,
        ).pack(side=tk.LEFT, padx=(10, 0))
        ttk.Checkbutton(
            opts,
            text="Create indexes",
            variable=self._create_indexes_var,
        ).pack(side=tk.LEFT, padx=(10, 0))

        data_frame.columnconfigure(1, weight=1)

        actions = ttk.Frame(self)
        actions.pack(fill=tk.X, padx=10)

        self._start_btn = ttk.Button(
            actions,
            text="Start Import",
            command=self._start_import,
        )
        self._start_btn.pack(side=tk.LEFT)

        ttk.Button(
            actions,
            text="Scan CSV Counts",
            command=self._scan_csv_counts,
        ).pack(side=tk.LEFT, padx=(8, 0))

        self._cancel_btn = ttk.Button(
            actions,
            text="Stop",
            command=self._cancel_import,
            state=tk.DISABLED,
        )
        self._cancel_btn.pack(side=tk.LEFT, padx=(8, 0))

        ttk.Button(
            actions,
            text="Clear Log",
            command=self._clear_log,
        ).pack(side=tk.LEFT, padx=(8, 0))

        status = ttk.Frame(self)
        status.pack(fill=tk.X, padx=10, pady=(8, 0))

        ttk.Label(status, textvariable=self._status_var).pack(side=tk.LEFT)
        ttk.Label(
            status,
            textvariable=self._progress_text_var,
        ).pack(side=tk.RIGHT)

        self._progress = ttk.Progressbar(
            self,
            orient="horizontal",
            mode="determinate",
        )
        self._progress.pack(fill=tk.X, padx=10, pady=(6, 10))

        table_frame = ttk.LabelFrame(self, text="Tables")
        table_frame.pack(fill=tk.BOTH, expand=False, padx=10, pady=(0, 10))

        cols = (
            "table",
            "total",
            "loaded",
            "remaining",
            "percent",
        )
        self._table_view = ttk.Treeview(
            table_frame,
            columns=cols,
            show="headings",
            height=8,
        )
        self._table_view.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        self._table_view.heading("table", text="Table")
        self._table_view.heading("total", text="CSV Rows")
        self._table_view.heading("loaded", text="Loaded")
        self._table_view.heading("remaining", text="Remaining")
        self._table_view.heading("percent", text="%")

        self._table_view.column("table", width=220, anchor="w")
        self._table_view.column("total", width=110, anchor="e")
        self._table_view.column("loaded", width=110, anchor="e")
        self._table_view.column("remaining", width=110, anchor="e")
        self._table_view.column("percent", width=70, anchor="e")

        tv_scroll = ttk.Scrollbar(
            table_frame,
            orient="vertical",
            command=self._table_view.yview,
        )
        tv_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        self._table_view.configure(yscrollcommand=tv_scroll.set)

        log_frame = ttk.LabelFrame(self, text="Log")
        log_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))

        self._log_text = tk.Text(log_frame, wrap="word")
        self._log_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        yscroll = ttk.Scrollbar(
            log_frame,
            orient="vertical",
            command=self._log_text.yview,
        )
        yscroll.pack(side=tk.RIGHT, fill=tk.Y)
        self._log_text.configure(yscrollcommand=yscroll.set)

        self._log_text.tag_configure("INFO", foreground="#222")
        self._log_text.tag_configure("WARNING", foreground="#9a6a00")
        self._log_text.tag_configure("ERROR", foreground="#b00020")

    @staticmethod
    def _grid_label_entry(
        parent: ttk.Frame,
        row: int,
        label: str,
        var: tk.StringVar,
    ):
        ttk.Label(parent, text=label).grid(
            row=row,
            column=0,
            sticky="w",
            padx=6,
            pady=4,
        )
        entry = ttk.Entry(parent, textvariable=var)
        entry.grid(row=row, column=1, sticky="ew", padx=6, pady=4)

    def _browse_dataset_dir(self):
        directory = filedialog.askdirectory(title="Select FDC dataset folder")
        if directory:
            self._dataset_dir_var.set(directory)

    def _clear_log(self):
        self._log_text.delete("1.0", tk.END)

    def _append_log(self, level: str, msg: str):
        ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        line = f"[{ts}] {level}: {msg}\n"
        self._log_text.insert(tk.END, line, level)
        self._log_text.see(tk.END)

        if self._state.log_file is not None:
            try:
                self._state.log_file.parent.mkdir(parents=True, exist_ok=True)
                with self._state.log_file.open("a", encoding="utf-8") as f:
                    f.write(line)
            except Exception:
                pass

    def _set_busy(self, busy: bool):
        if busy:
            self._start_btn.configure(state=tk.DISABLED)
            self._cancel_btn.configure(state=tk.NORMAL)
        else:
            self._start_btn.configure(state=tk.NORMAL)
            self._cancel_btn.configure(state=tk.DISABLED)

    def _test_connection(self):
        try:
            port = int(self._port_var.get().strip())
        except ValueError:
            messagebox.showerror("Invalid Port", "Port must be a number")
            return

        try:
            conn = mysql.connector.connect(
                host=self._host_var.get().strip(),
                port=port,
                user=self._user_var.get().strip(),
                password=self._password_var.get(),
                database=self._database_var.get().strip(),
                connection_timeout=10,
            )
            conn.close()
            messagebox.showinfo("Connection OK", "Successfully connected to MySQL")
        except Exception as e:
            messagebox.showerror("Connection Failed", str(e))

    def _open_log_file(self):
        if self._state.log_file is None:
            messagebox.showinfo(
                "No Log Yet",
                "Start an import to create a log file",
            )
            return
        try:
            import os

            os.startfile(str(self._state.log_file))
        except Exception as e:
            messagebox.showerror("Open Failed", str(e))

    def _start_import(self):
        if (
            self._state.import_thread is not None
            and self._state.import_thread.is_alive()
        ):
            messagebox.showwarning("Busy", "Import is already running")
            return

        dataset_dir = Path(self._dataset_dir_var.get().strip())
        if not dataset_dir.exists():
            messagebox.showerror(
                "Invalid Dataset Folder",
                "Dataset folder does not exist",
            )
            return

        try:
            port = int(self._port_var.get().strip())
        except ValueError:
            messagebox.showerror("Invalid Port", "Port must be a number")
            return

        stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        self._state.log_file = (
            Path(__file__).resolve().parent
            / "logs"
            / f"import_{stamp}.log"
        )

        options = ImportOptions(
            dataset_dir=dataset_dir,
            host=self._host_var.get().strip(),
            port=port,
            user=self._user_var.get().strip(),
            password=self._password_var.get(),
            database=self._database_var.get().strip(),
            create_tables=self._create_tables_var.get(),
            truncate=self._truncate_var.get(),
            load_data=self._load_data_var.get(),
            create_indexes=self._create_indexes_var.get(),
        )

        cancel_event = threading.Event()
        self._state.cancel_event = cancel_event

        callbacks = ImportCallbacks(
            log=lambda level, msg: self._queue.put(("log", (level, msg))),
            progress=lambda cur, total, msg: self._queue.put(
                ("progress", (cur, total, msg))
            ),
            status=lambda msg: self._queue.put(("status", msg)),
            table_loaded=lambda table, rows: self._queue.put(
                ("table_loaded", (table, rows))
            ),
        )

        self._progress.configure(value=0, maximum=1)
        self._status_var.set("Starting")
        self._progress_text_var.set("")
        self._set_busy(True)

        def worker():
            try:
                self._queue.put(("scan", str(dataset_dir)))
                run_import(options, callbacks=callbacks, cancel_event=cancel_event)
                self._queue.put(("done", None))
            except ImportCancelled:
                self._queue.put(("cancelled", None))
            except Exception as e:
                self._queue.put(("error", repr(e)))

        t = threading.Thread(target=worker, daemon=True)
        self._state.import_thread = t
        t.start()

    def _cancel_import(self):
        if self._state.cancel_event is not None:
            self._state.cancel_event.set()
            self._append_log(
                "WARNING",
                "Stop requested; waiting for current step to finish",
            )

    def _poll_queue(self):
        try:
            while True:
                kind, payload = self._queue.get_nowait()
                if kind == "log":
                    level, msg = payload
                    self._append_log(level, msg)
                elif kind == "status":
                    self._status_var.set(str(payload))
                elif kind == "progress":
                    cur, total, msg = payload
                    total = max(int(total), 1)
                    self._progress.configure(maximum=total)
                    self._progress.configure(value=int(cur))
                    self._progress_text_var.set(
                        f"{cur}/{total} - {msg}"
                    )
                elif kind == "done":
                    self._set_busy(False)
                    self._status_var.set("Done")
                    self._append_log("INFO", "Import finished")
                    messagebox.showinfo("Import Complete", "Import finished successfully")
                elif kind == "cancelled":
                    self._set_busy(False)
                    self._status_var.set("Cancelled")
                    self._append_log("WARNING", "Import cancelled")
                elif kind == "error":
                    self._set_busy(False)
                    self._status_var.set("Error")
                    self._append_log("ERROR", str(payload))
                    messagebox.showerror("Import Failed", "See log window for details")
                elif kind == "scan":
                    try:
                        self._scan_csv_counts(Path(str(payload)))
                    except Exception:
                        pass
                elif kind == "table_total":
                    table, total = payload
                    self._table_totals[str(table)] = int(total)
                    self._refresh_table_row(str(table))
                elif kind == "table_loaded":
                    table, loaded = payload
                    if loaded is None:
                        loaded = -1
                    self._table_loaded[str(table)] = int(loaded)
                    self._refresh_table_row(str(table))
        except queue.Empty:
            pass
        finally:
            self.after(100, self._poll_queue)

    def _refresh_table_row(self, table: str):
        total = self._table_totals.get(table)
        loaded = self._table_loaded.get(table)

        def fmt(v: Optional[int]) -> str:
            if v is None:
                return ""
            if v < 0:
                return "?"
            return f"{v:,}"

        remaining: Optional[int]
        percent = ""
        if total is not None and loaded is not None and total >= 0 and loaded >= 0:
            remaining = max(total - loaded, 0)
            if total > 0:
                percent = f"{(loaded / total) * 100:.1f}"
        else:
            remaining = None

        values = (
            table,
            fmt(total),
            fmt(loaded),
            fmt(remaining),
            percent,
        )

        if self._table_view.exists(table):
            self._table_view.item(table, values=values)
        else:
            self._table_view.insert("", tk.END, iid=table, values=values)

    def _scan_csv_counts(self, dataset_dir: Optional[Path] = None):
        if dataset_dir is None:
            dataset_dir = Path(self._dataset_dir_var.get().strip())
        if not dataset_dir.exists():
            messagebox.showerror("Invalid Dataset Folder", "Dataset folder does not exist")
            return

        if self._state.import_thread is not None and self._state.import_thread.is_alive():
            self._append_log("INFO", "Scanning CSV counts in background")
        else:
            self._append_log("INFO", "Scanning CSV counts")

        tables = get_load_table_order()
        for t in tables:
            self._refresh_table_row(t)

        def count_rows(path: Path) -> int:
            with path.open("rb") as f:
                buf_size = 8 * 1024 * 1024
                newlines = 0
                last = b""
                while True:
                    chunk = f.read(buf_size)
                    if not chunk:
                        break
                    newlines += chunk.count(b"\n")
                    last = chunk
                if path.stat().st_size == 0:
                    return 0
                if last and not last.endswith(b"\n"):
                    newlines += 1
                rows = max(newlines - 1, 0)
                return rows

        def worker():
            for table in tables:
                try:
                    csv_path = get_table_csv_path(dataset_dir, table)
                    if not csv_path.exists():
                        continue
                    total = count_rows(csv_path)
                    self._queue.put(("table_total", (table, total)))
                except Exception:
                    continue

        threading.Thread(target=worker, daemon=True).start()


def main():
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()
