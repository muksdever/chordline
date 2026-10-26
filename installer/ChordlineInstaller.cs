/*
 * Chordline Installer
 * Installs, updates and removes Chordline for Discord Stable, PTB and Canary on Windows.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
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

namespace Chordline
{
    class Branch
    {
        public string Name;
        public string Folder;
        public string ExeName;
        public Label Status;
        public Button InstallButton;
        public Button UninstallButton;

        public Branch(string name, string folder, string exeName)
        {
            Name = name;
            Folder = folder;
            ExeName = exeName;
        }

        public string Root
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Folder); }
        }

        public bool IsInstalled
        {
            get { return LatestResources() != null; }
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
            new Branch("Discord", "Discord", "Discord"),
            new Branch("Discord PTB", "DiscordPTB", "DiscordPTB"),
            new Branch("Discord Canary", "DiscordCanary", "DiscordCanary"),
        };

        readonly TextBox log;
        bool busy;

        public InstallerForm()
        {
            Text = "Chordline Installer";
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96F, 96F);
            Font = new Font("Segoe UI", 10F);
            ClientSize = new Size(560, 400);
            Padding = new Padding(16);

            var layout = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 4,
                RowCount = branches.Length + 3,
            };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 130));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            Controls.Add(layout);

            var title = new Label
            {
                Text = "Chordline",
                Font = new Font("Segoe UI Semibold", 18F),
                AutoSize = true,
                Margin = new Padding(0, 0, 0, 2),
            };
            layout.Controls.Add(title, 0, 0);
            layout.SetColumnSpan(title, 4);

            var subtitle = new Label
            {
                Text = "Pick which Discord to install or update Chordline on. Discord will restart.",
                ForeColor = SystemColors.GrayText,
                AutoSize = true,
                Margin = new Padding(0, 0, 0, 14),
            };
            layout.Controls.Add(subtitle, 0, 1);
            layout.SetColumnSpan(subtitle, 4);

            for (int i = 0; i < branches.Length; i++)
            {
                var branch = branches[i];
                int row = i + 2;
                layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));

                layout.Controls.Add(new Label
                {
                    Text = branch.Name,
                    Font = new Font("Segoe UI Semibold", 10F),
                    AutoSize = true,
                    Anchor = AnchorStyles.Left,
                }, 0, row);

                branch.Status = new Label { AutoSize = true, Anchor = AnchorStyles.Left, ForeColor = SystemColors.GrayText };
                layout.Controls.Add(branch.Status, 1, row);

                branch.InstallButton = new Button { Text = "Install / Update", AutoSize = true, Anchor = AnchorStyles.Right };
                branch.InstallButton.Click += delegate { Run(branch, true); };
                layout.Controls.Add(branch.InstallButton, 2, row);

                branch.UninstallButton = new Button { Text = "Uninstall", AutoSize = true, Anchor = AnchorStyles.Right };
                branch.UninstallButton.Click += delegate { Run(branch, false); };
                layout.Controls.Add(branch.UninstallButton, 3, row);
            }

            log = new TextBox
            {
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                Dock = DockStyle.Fill,
                Font = new Font("Consolas", 9F),
                Margin = new Padding(0, 14, 0, 0),
            };
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            layout.Controls.Add(log, 0, branches.Length + 2);
            layout.SetColumnSpan(log, 4);

            RefreshStatus();
        }

        void RefreshStatus()
        {
            foreach (var branch in branches)
            {
                string resources = branch.LatestResources();
                bool modded = resources != null && File.Exists(Path.Combine(resources, "_app.asar"));

                if (resources == null)
                    branch.Status.Text = "Not found on this PC";
                else if (!modded)
                    branch.Status.Text = "Not modded";
                else if (ReadText(Path.Combine(resources, "app.asar")).Contains("Chordline"))
                    branch.Status.Text = "Chordline installed";
                else
                    branch.Status.Text = "Another mod installed";

                branch.InstallButton.Enabled = !busy && resources != null;
                branch.UninstallButton.Enabled = !busy && modded;
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
        }

        void Run(Branch branch, bool install)
        {
            if (busy) return;

            bool wasRunning = Process.GetProcessesByName(branch.ExeName).Length > 0;
            if (wasRunning)
            {
                var answer = MessageBox.Show(this,
                    branch.Name + " is running and needs to be closed. Close it now?",
                    Text, MessageBoxButtons.OKCancel, MessageBoxIcon.Information);
                if (answer != DialogResult.OK) return;
            }

            busy = true;
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
                    Log("Done!");
                }
                catch (Exception ex)
                {
                    error = ex.Message;
                    Log("Error: " + ex.Message);
                }

                BeginInvoke(new Action(() =>
                {
                    busy = false;
                    RefreshStatus();
                    if (error != null)
                        MessageBox.Show(this, "Something went wrong:\n\n" + error, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
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

        void DownloadLatest()
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;

            Log("Checking for the latest Chordline release");
            var release = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(
                Fetch("https://api.github.com/repos/" + Repo + "/releases/latest"));

            Log("Latest: " + release["name"]);
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

        [STAThread]
        static void Main()
        {
            try { SetProcessDPIAware(); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm());
        }
    }
}
