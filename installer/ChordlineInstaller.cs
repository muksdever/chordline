/*
 * Chordline Installer
 * Installs, updates and removes Chordline for Discord Stable, PTB and Canary on Windows.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Note: this is compiled with the C# 5 compiler that ships with Windows (see build.ps1),
 * so newer syntax like string interpolation and ?. isn't available.
 */

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Chordline Installer")]
[assembly: System.Reflection.AssemblyProduct("Chordline")]
[assembly: System.Reflection.AssemblyDescription("Install and update Chordline for Discord")]

namespace Chordline
{
    static class Theme
    {
        public static readonly Color Background = Color.FromArgb(17, 15, 28);
        public static readonly Color TitleBar = Color.FromArgb(13, 11, 22);
        public static readonly Color Card = Color.FromArgb(27, 24, 46);
        public static readonly Color CardBorder = Color.FromArgb(42, 37, 71);
        public static readonly Color Text = Color.FromArgb(242, 240, 255);
        public static readonly Color Muted = Color.FromArgb(150, 144, 184);
        public static readonly Color Purple = Color.FromArgb(139, 92, 246);
        public static readonly Color Cyan = Color.FromArgb(34, 211, 238);
        public static readonly Color Green = Color.FromArgb(87, 242, 135);
        public static readonly Color Orange = Color.FromArgb(251, 184, 72);
        public static readonly Color Red = Color.FromArgb(237, 66, 69);
        public static readonly Color Grey = Color.FromArgb(120, 114, 150);

        public static Font Font(float size, FontStyle style)
        {
            return new Font("Segoe UI", size, style, GraphicsUnit.Point);
        }

        public static Font SemiBold(float size)
        {
            try { return new Font("Segoe UI Semibold", size, FontStyle.Regular, GraphicsUnit.Point); }
            catch { return Font(size, FontStyle.Bold); }
        }

        public static GraphicsPath RoundedRect(RectangleF r, float radius)
        {
            var path = new GraphicsPath();
            float d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
            if (d <= 0) { path.AddRectangle(r); return path; }
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        public static void Smooth(Graphics g)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        }
    }

    // Draws the Chordline logo (same shapes as installer/logo.svg) at any size
    static class Logo
    {
        public static void Draw(Graphics g, RectangleF r)
        {
            float s = r.Width / 64f;
            Func<float, float, PointF> P = (x, y) => new PointF(r.X + x * s, r.Y + y * s);

            using (var bg = Theme.RoundedRect(r, 16 * s))
            using (var brush = new LinearGradientBrush(r.Location, new PointF(r.Right, r.Bottom), Theme.Purple, Theme.Cyan))
                g.FillPath(brush, bg);

            using (var strings = new Pen(Color.FromArgb(56, 255, 255, 255), 2 * s))
            {
                strings.StartCap = strings.EndCap = LineCap.Round;
                foreach (float y in new float[] { 20, 32, 44 })
                    g.DrawLine(strings, P(12, y), P(52, y));
            }

            using (var wave = new GraphicsPath())
            using (var pen = new Pen(Color.White, 5.5f * s))
            {
                pen.StartCap = pen.EndCap = LineCap.Round;
                pen.LineJoin = LineJoin.Round;
                // M12 36 C18 36 20 22 26 22 S34 42 40 42 S48 28 52 28
                wave.AddBezier(P(12, 36), P(18, 36), P(20, 22), P(26, 22));
                wave.AddBezier(P(26, 22), P(32, 22), P(34, 42), P(40, 42));
                wave.AddBezier(P(40, 42), P(46, 42), P(48, 28), P(52, 28));
                g.DrawPath(pen, wave);
            }

            float dot = 4.5f * s;
            PointF c = P(52, 28);
            using (var white = new SolidBrush(Color.White))
                g.FillEllipse(white, c.X - dot, c.Y - dot, dot * 2, dot * 2);
        }

        public static Bitmap Render(int size)
        {
            var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp))
            {
                Theme.Smooth(g);
                g.Clear(Color.Transparent);
                Draw(g, new RectangleF(0, 0, size, size));
            }
            return bmp;
        }

        // A .ico with PNG images at several sizes, used as the exe's icon (see build.ps1)
        public static void WriteIcon(string path)
        {
            int[] sizes = { 16, 24, 32, 48, 64, 128, 256 };
            var images = new List<byte[]>();
            foreach (int size in sizes)
            {
                using (var bmp = Render(size))
                using (var ms = new MemoryStream())
                {
                    bmp.Save(ms, ImageFormat.Png);
                    images.Add(ms.ToArray());
                }
            }

            using (var fs = File.Create(path))
            using (var w = new BinaryWriter(fs))
            {
                w.Write((short)0);
                w.Write((short)1);
                w.Write((short)sizes.Length);
                int offset = 6 + 16 * sizes.Length;
                for (int i = 0; i < sizes.Length; i++)
                {
                    w.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
                    w.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
                    w.Write((byte)0);
                    w.Write((byte)0);
                    w.Write((short)1);
                    w.Write((short)32);
                    w.Write(images[i].Length);
                    w.Write(offset);
                    offset += images[i].Length;
                }
                foreach (var img in images) w.Write(img);
            }
        }
    }

    class FlatButton : Control
    {
        public enum Kind { Primary, Secondary, Danger, Ghost }

        public Kind Style = Kind.Secondary;
        public float Radius = 8;
        bool hover, down;

        public FlatButton()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw |
                     ControlStyles.UserPaint | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
            Font = Theme.SemiBold(9.5f);
            Cursor = Cursors.Hand;
        }

        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = down = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { down = true; Invalidate(); base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { down = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnEnabledChanged(EventArgs e) { Cursor = Enabled ? Cursors.Hand : Cursors.Default; Invalidate(); base.OnEnabledChanged(e); }
        protected override void OnTextChanged(EventArgs e) { Invalidate(); base.OnTextChanged(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            Theme.Smooth(g);
            var r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
            int alpha = Enabled ? 255 : 90;
            Color text = Color.FromArgb(alpha, Theme.Text);

            using (var path = Theme.RoundedRect(r, Radius))
            {
                if (Style == Kind.Primary)
                {
                    Color a = Theme.Purple, b = Theme.Cyan;
                    if (hover && Enabled) { a = ControlPaint.Light(a, 0.15f); b = ControlPaint.Light(b, 0.15f); }
                    if (down && Enabled) { a = ControlPaint.Dark(a, 0.05f); b = ControlPaint.Dark(b, 0.05f); }
                    using (var brush = new LinearGradientBrush(r, Color.FromArgb(alpha, a), Color.FromArgb(alpha, b), LinearGradientMode.Horizontal))
                        g.FillPath(brush, path);
                    text = Color.FromArgb(alpha, Color.White);
                }
                else if (Style == Kind.Ghost)
                {
                    if (hover && Enabled)
                        using (var brush = new SolidBrush(Color.FromArgb(down ? 50 : 30, 255, 255, 255)))
                            g.FillPath(brush, path);
                    text = Color.FromArgb(alpha, hover ? Theme.Text : Theme.Muted);
                }
                else
                {
                    bool danger = Style == Kind.Danger;
                    Color fill = Color.FromArgb(hover && Enabled ? (danger ? 60 : 34) : 18, danger && hover && Enabled ? Theme.Red : Color.White);
                    using (var brush = new SolidBrush(fill)) g.FillPath(brush, path);
                    using (var pen = new Pen(Color.FromArgb(Enabled ? 70 : 30, danger ? Theme.Red : Color.White)))
                        g.DrawPath(pen, path);
                    if (danger) text = Color.FromArgb(alpha, hover && Enabled ? Color.White : Color.FromArgb(255, 160, 162));
                }
            }

            TextRenderer.DrawText(g, Text, Font, ClientRectangle, text,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }
    }

    class RoundPanel : Panel
    {
        public Color Fill = Theme.Card;
        public Color Border = Theme.CardBorder;
        public float Radius = 12;

        public RoundPanel()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
            BackColor = Theme.Background;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Theme.Smooth(e.Graphics);
            using (var path = Theme.RoundedRect(new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f), Radius))
            using (var brush = new SolidBrush(Fill))
            using (var pen = new Pen(Border))
            {
                e.Graphics.FillPath(brush, path);
                e.Graphics.DrawPath(pen, path);
            }
        }
    }

    // A small app icon square with a letter, tinted per Discord version
    class BranchIcon : Control
    {
        public Color Tint;
        public string Letter;

        public BranchIcon()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
            Font = Theme.SemiBold(14f);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            Theme.Smooth(g);
            var r = new RectangleF(0, 0, Width - 1, Height - 1);
            using (var path = Theme.RoundedRect(r, 11))
            using (var brush = new LinearGradientBrush(r, Tint, ControlPaint.Dark(Tint, 0.15f), LinearGradientMode.ForwardDiagonal))
                g.FillPath(brush, path);
            TextRenderer.DrawText(g, Letter, Font, ClientRectangle, Color.White,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }
    }

    class StatusPill : Control
    {
        public Color Tint = Theme.Grey;

        public StatusPill()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
            Font = Theme.SemiBold(8.5f);
        }

        protected override void OnTextChanged(EventArgs e)
        {
            var size = TextRenderer.MeasureText(Text, Font);
            Width = size.Width + 26;
            Invalidate();
            base.OnTextChanged(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            Theme.Smooth(g);
            var r = new RectangleF(0, 0, Width - 1, Height - 1);
            using (var path = Theme.RoundedRect(r, r.Height / 2))
            using (var brush = new SolidBrush(Color.FromArgb(38, Tint)))
                g.FillPath(brush, path);
            using (var dot = new SolidBrush(Tint))
                g.FillEllipse(dot, 9, Height / 2f - 3, 6, 6);
            TextRenderer.DrawText(g, Text, Font, new Rectangle(18, 0, Width - 20, Height), Tint,
                TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.NoPadding);
        }
    }

    // Thin progress bar with an animated shimmer while busy
    class ProgressStrip : Control
    {
        bool active;
        float phase;
        readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 16 };

        public ProgressStrip()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
            timer.Tick += delegate { phase = (phase + 0.012f) % 1f; Invalidate(); };
        }

        public bool Active
        {
            get { return active; }
            set { active = value; timer.Enabled = value; Invalidate(); }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            Theme.Smooth(g);
            var r = new RectangleF(0, 0, Width - 1, Height - 1);
            using (var track = Theme.RoundedRect(r, r.Height / 2))
            using (var brush = new SolidBrush(Color.FromArgb(24, 255, 255, 255)))
                g.FillPath(brush, track);
            if (!active) return;

            float w = r.Width * 0.35f;
            float x = -w + (r.Width + w) * phase;
            var bar = new RectangleF(Math.Max(0, x), 0, Math.Min(w, r.Right - Math.Max(0, x)), r.Height);
            if (bar.Width <= 1) return;
            using (var path = Theme.RoundedRect(bar, r.Height / 2))
            using (var grad = new LinearGradientBrush(new RectangleF(x, 0, w, r.Height), Theme.Purple, Theme.Cyan, LinearGradientMode.Horizontal))
                g.FillPath(grad, path);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) timer.Dispose();
            base.Dispose(disposing);
        }
    }

    class Branch
    {
        public string Name;
        public string Folder;
        public string ExeName;
        public string Letter;
        public Color Tint;

        public StatusPill Status;
        public FlatButton InstallButton;
        public FlatButton UninstallButton;

        public Branch(string name, string folder, string exeName, string letter, Color tint)
        {
            Name = name;
            Folder = folder;
            ExeName = exeName;
            Letter = letter;
            Tint = tint;
        }

        public string Root
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Folder); }
        }

        // Discord keeps each version in its own app-x.y.z folder; only the newest one is used
        public string LatestResources()
        {
            if (!Directory.Exists(Root)) return null;

            return Directory.GetDirectories(Root, "app-*")
                .Select(dir => new { Dir = dir, Version = ParseVersion(Path.GetFileName(dir).Substring(4)) })
                .Where(x => x.Version != null)
                .OrderByDescending(x => x.Version)
                .Select(x => Path.Combine(x.Dir, "resources"))
                .FirstOrDefault(res => File.Exists(Path.Combine(res, "app.asar")) || File.Exists(Path.Combine(res, "_app.asar")));
        }

        public IEnumerable<string> AllResources()
        {
            if (!Directory.Exists(Root)) return new string[0];
            return Directory.GetDirectories(Root, "app-*").Select(dir => Path.Combine(dir, "resources")).Where(Directory.Exists);
        }

        static Version ParseVersion(string s)
        {
            Version v;
            return Version.TryParse(s, out v) ? v : null;
        }
    }

    class InstallerForm : Form
    {
        const string Repo = "muksdever/chordline";
        const string UserAgent = "ChordlineInstaller (https://github.com/" + Repo + ")";

        // Files the in-app updater also downloads (plus their .map / .LEGAL.txt companions)
        static readonly string[] ModFiles = { "patcher.js", "preload.js", "renderer.js", "renderer.css" };

        static readonly string DistDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Chordline", "dist");

        readonly Branch[] branches =
        {
            new Branch("Discord", "Discord", "Discord", "D", Color.FromArgb(88, 101, 242)),
            new Branch("Discord PTB", "DiscordPTB", "DiscordPTB", "P", Color.FromArgb(66, 133, 244)),
            new Branch("Discord Canary", "DiscordCanary", "DiscordCanary", "C", Color.FromArgb(240, 160, 50)),
        };

        readonly Label statusLabel;
        readonly Label versionLabel;
        readonly ProgressStrip progress;
        readonly TextBox log;
        readonly LinkLabel detailsLink;
        readonly int compactHeight;
        bool busy;
        string latestRelease;

        public InstallerForm()
        {
            Text = "Chordline Installer";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96F, 96F);
            BackColor = Theme.Background;
            ForeColor = Theme.Text;
            Font = Theme.Font(9.5f, FontStyle.Regular);
            DoubleBuffered = true;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            const int W = 540;
            const int Pad = 28;

            // Title bar
            var titleBar = new Panel { Bounds = new Rectangle(0, 0, W, 40), BackColor = Theme.TitleBar };
            titleBar.MouseDown += DragWindow;
            titleBar.Paint += (s, e) =>
            {
                Theme.Smooth(e.Graphics);
                Logo.Draw(e.Graphics, new RectangleF(14, 11, 18, 18));
                TextRenderer.DrawText(e.Graphics, "Chordline Installer", Theme.SemiBold(9f), new Point(40, 12), Theme.Muted);
            };
            var close = new FlatButton { Text = "✕", Style = FlatButton.Kind.Ghost, Bounds = new Rectangle(W - 44, 4, 36, 32), Font = Theme.Font(10f, FontStyle.Regular), Radius = 6 };
            close.Click += delegate { Close(); };
            var minimize = new FlatButton { Text = "–", Style = FlatButton.Kind.Ghost, Bounds = new Rectangle(W - 82, 4, 36, 32), Font = Theme.Font(11f, FontStyle.Regular), Radius = 6 };
            minimize.Click += delegate { WindowState = FormWindowState.Minimized; };
            titleBar.Controls.Add(close);
            titleBar.Controls.Add(minimize);
            Controls.Add(titleBar);

            // Header
            var header = new Panel { Bounds = new Rectangle(0, 40, W, 112), BackColor = Theme.Background };
            header.MouseDown += DragWindow;
            header.Paint += (s, e) =>
            {
                Theme.Smooth(e.Graphics);
                // soft glow behind the logo
                using (var glowPath = new GraphicsPath())
                {
                    glowPath.AddEllipse(Pad - 30, 0, 130, 120);
                    using (var glow = new PathGradientBrush(glowPath) { CenterColor = Color.FromArgb(70, Theme.Purple), SurroundColors = new[] { Color.FromArgb(0, Theme.Purple) } })
                        e.Graphics.FillPath(glow, glowPath);
                }
                Logo.Draw(e.Graphics, new RectangleF(Pad, 26, 60, 60));
                TextRenderer.DrawText(e.Graphics, "Chordline", Theme.SemiBold(20f), new Point(Pad + 76, 26), Theme.Text);
                TextRenderer.DrawText(e.Graphics, "Install or update Chordline on your Discord", Theme.Font(9.5f, FontStyle.Regular), new Point(Pad + 79, 62), Theme.Muted);
            };
            Controls.Add(header);

            var section = new Label
            {
                Text = "YOUR DISCORD APPS",
                Font = Theme.SemiBold(8f),
                ForeColor = Theme.Muted,
                AutoSize = true,
                Location = new Point(Pad, 158),
                BackColor = Theme.Background,
            };
            Controls.Add(section);

            int y = 182;
            foreach (var branch in branches)
            {
                Controls.Add(BuildCard(branch, new Rectangle(Pad, y, W - Pad * 2, 76)));
                y += 88;
            }

            // Footer: status + progress
            statusLabel = new Label
            {
                Text = "Ready",
                Font = Theme.Font(9f, FontStyle.Regular),
                ForeColor = Theme.Muted,
                AutoEllipsis = true,
                Bounds = new Rectangle(Pad, y + 8, W - Pad * 2 - 110, 20),
                BackColor = Theme.Background,
            };
            Controls.Add(statusLabel);

            detailsLink = new LinkLabel
            {
                Text = "Show details",
                Font = Theme.Font(9f, FontStyle.Regular),
                LinkColor = Theme.Muted,
                ActiveLinkColor = Theme.Text,
                LinkBehavior = LinkBehavior.HoverUnderline,
                TextAlign = ContentAlignment.MiddleRight,
                Bounds = new Rectangle(W - Pad - 100, y + 8, 100, 20),
                BackColor = Theme.Background,
            };
            detailsLink.Click += delegate { ToggleDetails(); };
            Controls.Add(detailsLink);

            progress = new ProgressStrip { Bounds = new Rectangle(Pad, y + 34, W - Pad * 2, 6) };
            Controls.Add(progress);

            versionLabel = new Label
            {
                Text = "Checking for the latest build...",
                Font = Theme.Font(8.5f, FontStyle.Regular),
                ForeColor = Color.FromArgb(110, 104, 140),
                AutoSize = true,
                Location = new Point(Pad, y + 52),
                BackColor = Theme.Background,
            };
            Controls.Add(versionLabel);

            compactHeight = y + 82;

            log = new TextBox
            {
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                BorderStyle = BorderStyle.None,
                BackColor = Theme.Card,
                ForeColor = Theme.Muted,
                Font = new Font("Consolas", 8.5f),
                Bounds = new Rectangle(Pad, compactHeight, W - Pad * 2, 120),
            };
            Controls.Add(log);

            ClientSize = new Size(W, compactHeight);
            RefreshStatus();
            CheckLatestRelease();
        }

        Control BuildCard(Branch branch, Rectangle bounds)
        {
            var card = new RoundPanel { Bounds = bounds };

            card.Controls.Add(new BranchIcon { Tint = branch.Tint, Letter = branch.Letter, Bounds = new Rectangle(16, 16, 44, 44) });
            card.Controls.Add(new Label
            {
                Text = branch.Name,
                Font = Theme.SemiBold(11f),
                ForeColor = Theme.Text,
                AutoSize = true,
                Location = new Point(72, 14),
                BackColor = Theme.Card,
            });

            branch.Status = new StatusPill { Location = new Point(72, 42), Height = 20 };
            card.Controls.Add(branch.Status);

            branch.UninstallButton = new FlatButton { Text = "Uninstall", Style = FlatButton.Kind.Danger, Bounds = new Rectangle(bounds.Width - 104, 21, 88, 34) };
            branch.UninstallButton.Click += delegate { Run(branch, false); };
            card.Controls.Add(branch.UninstallButton);

            branch.InstallButton = new FlatButton { Text = "Install", Style = FlatButton.Kind.Primary, Bounds = new Rectangle(bounds.Width - 206, 21, 94, 34) };
            branch.InstallButton.Click += delegate { Run(branch, true); };
            card.Controls.Add(branch.InstallButton);

            return card;
        }

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ClassStyle |= 0x20000; // CS_DROPSHADOW, since the window has no border
                return cp;
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            try
            {
                int round = 2; // DWMWCP_ROUND: rounded corners on Windows 11
                DwmSetWindowAttribute(Handle, 33, ref round, sizeof(int));
            }
            catch { }
        }

        void DragWindow(object sender, MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left) return;
            ReleaseCapture();
            SendMessage(Handle, 0xA1, (IntPtr)2, IntPtr.Zero); // WM_NCLBUTTONDOWN on the caption
        }

        void ToggleDetails()
        {
            bool show = ClientSize.Height == compactHeight;
            ClientSize = new Size(ClientSize.Width, show ? compactHeight + 136 : compactHeight);
            detailsLink.Text = show ? "Hide details" : "Show details";
        }

        void RefreshStatus()
        {
            foreach (var branch in branches)
            {
                string resources = branch.LatestResources();
                bool modded = resources != null && File.Exists(Path.Combine(resources, "_app.asar"));
                bool chordline = modded && ReadText(Path.Combine(resources, "app.asar")).Contains("Chordline");

                if (resources == null) { branch.Status.Text = "Not installed on this PC"; branch.Status.Tint = Theme.Grey; }
                else if (chordline) { branch.Status.Text = "Chordline installed"; branch.Status.Tint = Theme.Green; }
                else if (modded) { branch.Status.Text = "Another mod installed"; branch.Status.Tint = Theme.Orange; }
                else { branch.Status.Text = "Not modded"; branch.Status.Tint = Theme.Muted; }
                branch.Status.Invalidate();

                branch.InstallButton.Text = chordline ? "Update" : "Install";
                branch.InstallButton.Enabled = !busy && resources != null;
                branch.UninstallButton.Visible = modded;
                branch.UninstallButton.Enabled = !busy;
            }
        }

        void Log(string message)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action<string>(Log), message);
                return;
            }
            log.AppendText(message + Environment.NewLine);
            statusLabel.Text = message;
            statusLabel.ForeColor = Theme.Muted;
        }

        void CheckLatestRelease()
        {
            var thread = new Thread(() =>
            {
                string text;
                try { text = "Latest build: " + FetchRelease()["name"]; }
                catch { text = "Couldn't check for the latest build"; }
                BeginInvoke(new Action(() => versionLabel.Text = text));
            });
            thread.IsBackground = true;
            thread.Start();
        }

        void Run(Branch branch, bool install)
        {
            if (busy) return;

            bool wasRunning = Process.GetProcessesByName(branch.ExeName).Length > 0;
            if (wasRunning)
            {
                var answer = MessageBox.Show(this,
                    branch.Name + " is open and needs to restart. Close it now?",
                    Text, MessageBoxButtons.OKCancel, MessageBoxIcon.Information);
                if (answer != DialogResult.OK) return;
            }

            busy = true;
            progress.Active = true;
            RefreshStatus();
            log.Clear();

            var thread = new Thread(() =>
            {
                string error = null;
                try
                {
                    if (install) Install(branch);
                    else Uninstall(branch);

                    if (wasRunning || install) StartDiscord(branch);
                }
                catch (Exception ex)
                {
                    error = ex.Message;
                    Log("Error: " + ex.Message);
                }

                BeginInvoke(new Action(() =>
                {
                    busy = false;
                    progress.Active = false;
                    RefreshStatus();
                    if (error != null)
                    {
                        statusLabel.Text = "Something went wrong: " + error;
                        statusLabel.ForeColor = Theme.Red;
                    }
                    else
                    {
                        statusLabel.Text = install
                            ? "✓  Chordline is installed on " + branch.Name + "!"
                            : "✓  Chordline was removed from " + branch.Name;
                        statusLabel.ForeColor = Theme.Green;
                    }
                }));
            });
            thread.IsBackground = true;
            thread.Start();
        }

        void Install(Branch branch)
        {
            DownloadLatest();
            CloseDiscord(branch);

            string resources = branch.LatestResources();
            if (resources == null) throw new Exception(branch.Name + " could not be found.");

            string appAsar = Path.Combine(resources, "app.asar");
            string backupAsar = Path.Combine(resources, "_app.asar");

            // Keep Discord's original app.asar as _app.asar; Chordline's patcher loads it from there.
            // If _app.asar already exists, another mod (or an older Chordline) is installed and we just replace it.
            if (!File.Exists(backupAsar))
            {
                Log("Backing up Discord's app.asar");
                File.Move(appAsar, backupAsar);
            }

            Log("Patching " + branch.Name);
            File.WriteAllBytes(appAsar, BuildInjectorAsar(Path.Combine(DistDir, "patcher.js")));
        }

        void Uninstall(Branch branch)
        {
            CloseDiscord(branch);

            foreach (string resources in branch.AllResources())
            {
                string appAsar = Path.Combine(resources, "app.asar");
                string backupAsar = Path.Combine(resources, "_app.asar");
                if (!File.Exists(backupAsar)) continue;

                Log("Restoring original Discord in " + Path.GetFileName(Path.GetDirectoryName(resources)));
                if (File.Exists(appAsar)) File.Delete(appAsar);
                File.Move(backupAsar, appAsar);
            }
        }

        Dictionary<string, object> FetchRelease()
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            var release = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(
                Fetch("https://api.github.com/repos/" + Repo + "/releases/latest"));
            latestRelease = (string)release["name"];
            return release;
        }

        void DownloadLatest()
        {
            Log("Checking for the latest Chordline build");
            var release = FetchRelease();

            Log("Downloading " + latestRelease);
            Directory.CreateDirectory(DistDir);

            int downloaded = 0;
            foreach (Dictionary<string, object> asset in (System.Collections.ArrayList)release["assets"])
            {
                string name = (string)asset["name"];
                if (!ModFiles.Any(f => name.StartsWith(f))) continue;

                Log("Downloading " + name);
                using (var client = NewClient())
                    client.DownloadFile((string)asset["browser_download_url"], Path.Combine(DistDir, name));
                downloaded++;
            }

            if (!File.Exists(Path.Combine(DistDir, "patcher.js")) || downloaded == 0)
                throw new Exception("The latest release doesn't contain Chordline's files yet.");
        }

        void CloseDiscord(Branch branch)
        {
            var processes = Process.GetProcessesByName(branch.ExeName);
            if (processes.Length == 0) return;

            Log("Closing " + branch.Name);
            foreach (var p in processes)
            {
                try { p.Kill(); } catch { }
            }
            foreach (var p in processes)
            {
                try { p.WaitForExit(10000); } catch { }
            }
            // Give Windows a moment to release file locks on app.asar
            Thread.Sleep(1000);
        }

        void StartDiscord(Branch branch)
        {
            string updateExe = Path.Combine(branch.Root, "Update.exe");
            if (!File.Exists(updateExe)) return;

            Log("Starting " + branch.Name);
            Process.Start(new ProcessStartInfo(updateExe, "--processStart " + branch.ExeName + ".exe")
            {
                UseShellExecute = false,
                WorkingDirectory = branch.Root,
            });
        }

        // The replacement app.asar is a tiny asar archive with an index.js that loads Chordline's patcher
        // (which then loads Discord's original _app.asar) and a package.json pointing at it.
        static byte[] BuildInjectorAsar(string patcherPath)
        {
            byte[] index = Encoding.UTF8.GetBytes("require(" + new JavaScriptSerializer().Serialize(patcherPath) + ")");
            byte[] pkg = Encoding.UTF8.GetBytes("{\n\t\"name\": \"discord\",\n\t\"main\": \"index.js\"\n}");

            string headerJson = "{\"files\":{"
                + "\"index.js\":{\"size\":" + index.Length + ",\"offset\":\"0\"},"
                + "\"package.json\":{\"size\":" + pkg.Length + ",\"offset\":\"" + index.Length + "\"}}}";
            byte[] header = Encoding.UTF8.GetBytes(headerJson);
            int aligned = (header.Length + 3) & ~3;

            using (var stream = new MemoryStream())
            using (var writer = new BinaryWriter(stream))
            {
                // Chromium Pickle framing used by the asar format
                writer.Write((uint)4);
                writer.Write((uint)(aligned + 8));
                writer.Write((uint)(aligned + 4));
                writer.Write((uint)header.Length);
                writer.Write(header);
                writer.Write(new byte[aligned - header.Length]);
                writer.Write(index);
                writer.Write(pkg);
                writer.Flush();
                return stream.ToArray();
            }
        }

        static WebClient NewClient()
        {
            var client = new WebClient();
            client.Headers[HttpRequestHeader.UserAgent] = UserAgent;
            return client;
        }

        static string Fetch(string url)
        {
            using (var client = NewClient())
            {
                client.Headers[HttpRequestHeader.Accept] = "application/vnd.github+json";
                client.Encoding = Encoding.UTF8;
                try
                {
                    return client.DownloadString(url);
                }
                catch (WebException ex)
                {
                    var response = ex.Response as HttpWebResponse;
                    if (response != null && response.StatusCode == HttpStatusCode.NotFound)
                        throw new Exception("No Chordline release has been published yet.");
                    throw new Exception("Couldn't reach GitHub (" + ex.Message + ")");
                }
            }
        }

        static string ReadText(string path)
        {
            try { return File.ReadAllText(path); }
            catch { return ""; }
        }

        [DllImport("user32.dll")]
        static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

        [DllImport("dwmapi.dll")]
        static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

        [STAThread]
        static void Main(string[] args)
        {
            // Used by build.ps1 to create the exe's icon from the same drawing code
            if (args.Length == 2 && args[0] == "--write-icon")
            {
                Logo.WriteIcon(args[1]);
                return;
            }

            try { SetProcessDPIAware(); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm());
        }
    }
}
