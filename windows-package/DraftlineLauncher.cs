using System;
using System.IO;
using System.Diagnostics;
using System.Net;
using System.Threading;
using System.Windows.Forms;
using System.Drawing;

namespace DraftlineApp
{
    static class Program
    {
        private static Process serverProcess = null;
        private static NotifyIcon trayIcon = null;
        private static Process browserProcess = null;
        private static string appUrl = "http://127.0.0.1:4318";
        private static string logFilePath = "";

        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool createdNew;
            using (Mutex mutex = new Mutex(true, "DraftlineSingleInstanceMutex_4318", out createdNew))
            {
                if (!createdNew)
                {
                    OpenAppWindow(appUrl);
                    return;
                }

                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string logDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Draftline");
                try { Directory.CreateDirectory(logDir); } catch { logDir = baseDir; }
                logFilePath = Path.Combine(logDir, "server.log");

                // Locate node.exe
                string nodeExe = Path.Combine(baseDir, "node.exe");
                if (!File.Exists(nodeExe))
                {
                    nodeExe = Path.Combine(baseDir, "..", "node.exe");
                }
                if (!File.Exists(nodeExe))
                {
                    nodeExe = FindOnPath("node.exe");
                }
                if (string.IsNullOrEmpty(nodeExe) || !File.Exists(nodeExe))
                {
                    MessageBox.Show(
                        "Could not find node.exe.\nPlease ensure node.exe is in the application folder or installed in PATH.",
                        "Draftline",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                // Locate server/index.mjs
                string serverScript = Path.Combine(baseDir, "server", "index.mjs");
                if (!File.Exists(serverScript))
                {
                    serverScript = Path.Combine(baseDir, "..", "server", "index.mjs");
                }
                if (!File.Exists(serverScript))
                {
                    MessageBox.Show(
                        "Could not find server/index.mjs in " + baseDir,
                        "Draftline",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                // Check port override in args
                for (int i = 0; i < args.Length; i++)
                {
                    if (args[i] == "--port" && i + 1 < args.Length)
                    {
                        appUrl = "http://127.0.0.1:" + args[i + 1];
                    }
                }

                // Start node server process
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = nodeExe;
                    string arguments = "\"" + serverScript + "\"";
                    if (args.Length > 0)
                    {
                        arguments += " " + string.Join(" ", args);
                    }
                    psi.Arguments = arguments;
                    psi.WorkingDirectory = baseDir;
                    psi.UseShellExecute = false;
                    psi.CreateNoWindow = true;
                    psi.WindowStyle = ProcessWindowStyle.Hidden;

                    // Redirect output to log file
                    psi.RedirectStandardOutput = true;
                    psi.RedirectStandardError = true;

                    serverProcess = new Process();
                    serverProcess.StartInfo = psi;

                    File.WriteAllText(logFilePath, "=== Draftline Server Started at " + DateTime.Now.ToString("s") + " ===\n");

                    serverProcess.OutputDataReceived += (s, e) =>
                    {
                        if (e.Data != null)
                        {
                            try { File.AppendAllText(logFilePath, e.Data + Environment.NewLine); } catch { }
                        }
                    };
                    serverProcess.ErrorDataReceived += (s, e) =>
                    {
                        if (e.Data != null)
                        {
                            try { File.AppendAllText(logFilePath, "[ERROR] " + e.Data + Environment.NewLine); } catch { }
                        }
                    };

                    serverProcess.Start();
                    serverProcess.BeginOutputReadLine();
                    serverProcess.BeginErrorReadLine();
                }
                catch (Exception ex)
                {
                    MessageBox.Show(
                        "Failed to start local server:\n" + ex.Message,
                        "Draftline",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                AppDomain.CurrentDomain.ProcessExit += (s, e) => Cleanup();
                Application.ApplicationExit += (s, e) => Cleanup();

                // Wait for server health
                bool ready = WaitForServer(appUrl, 12000);
                if (!ready)
                {
                    if (serverProcess.HasExited)
                    {
                        string logTail = "";
                        try
                        {
                            if (File.Exists(logFilePath))
                            {
                                string[] lines = File.ReadAllLines(logFilePath);
                                int start = Math.Max(0, lines.Length - 10);
                                logTail = string.Join("\n", lines, start, lines.Length - start);
                            }
                        }
                        catch { }

                        MessageBox.Show(
                            "The Draftline server exited unexpectedly.\n\nRecent logs:\n" + logTail,
                            "Draftline Error",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Error
                        );
                        Cleanup();
                        return;
                    }
                }

                // Setup Tray Icon
                trayIcon = new NotifyIcon();
                string iconPath = Path.Combine(baseDir, "Draftline.ico");
                if (File.Exists(iconPath))
                {
                    try { trayIcon.Icon = new Icon(iconPath); } catch { trayIcon.Icon = SystemIcons.Application; }
                }
                else
                {
                    trayIcon.Icon = SystemIcons.Application;
                }

                trayIcon.Text = "Draftline (" + appUrl + ")";
                trayIcon.Visible = true;

                ContextMenuStrip menu = new ContextMenuStrip();

                ToolStripMenuItem itemOpen = new ToolStripMenuItem("Open Draftline");
                itemOpen.Font = new Font(itemOpen.Font, FontStyle.Bold);
                itemOpen.Click += (s, e) => OpenAppWindow(appUrl);
                menu.Items.Add(itemOpen);

                ToolStripMenuItem itemBrowser = new ToolStripMenuItem("Open in Default Browser");
                itemBrowser.Click += (s, e) => {
                    try { Process.Start(appUrl); } catch { }
                };
                menu.Items.Add(itemBrowser);

                ToolStripMenuItem itemLogs = new ToolStripMenuItem("View Server Logs");
                itemLogs.Click += (s, e) => {
                    try { Process.Start("notepad.exe", logFilePath); } catch { }
                };
                menu.Items.Add(itemLogs);

                menu.Items.Add(new ToolStripSeparator());

                ToolStripMenuItem itemExit = new ToolStripMenuItem("Exit Draftline");
                itemExit.Click += (s, e) => {
                    Cleanup();
                    Application.Exit();
                };
                menu.Items.Add(itemExit);

                trayIcon.ContextMenuStrip = menu;
                trayIcon.DoubleClick += (s, e) => OpenAppWindow(appUrl);

                // Open app window immediately
                OpenAppWindow(appUrl);

                // Run message loop
                Application.Run();
            }
        }

        private static bool WaitForServer(string url, int timeoutMs)
        {
            string healthUrl = url.TrimEnd('/') + "/api/health";
            Stopwatch sw = Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < timeoutMs)
            {
                if (serverProcess != null && serverProcess.HasExited) return false;
                try
                {
                    HttpWebRequest request = (HttpWebRequest)WebRequest.Create(healthUrl);
                    request.Timeout = 500;
                    using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                    {
                        if ((int)response.StatusCode >= 200 && (int)response.StatusCode < 400)
                        {
                            return true;
                        }
                    }
                }
                catch
                {
                    Thread.Sleep(150);
                }
            }
            return false;
        }

        private static void OpenAppWindow(string url)
        {
            try
            {
                // Try Microsoft Edge in standalone app mode
                string edgePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe");
                if (!File.Exists(edgePath))
                {
                    edgePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe");
                }

                if (File.Exists(edgePath))
                {
                    string profileDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Draftline", "EdgeProfile");
                    browserProcess = Process.Start(new ProcessStartInfo
                    {
                        FileName = edgePath,
                        Arguments = "--app=" + url + " --user-data-dir=\"" + profileDir + "\"",
                        UseShellExecute = false
                    });
                    return;
                }

                // Try Chrome in app mode
                string chromePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe");
                if (!File.Exists(chromePath))
                {
                    chromePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe");
                }

                if (File.Exists(chromePath))
                {
                    string profileDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Draftline", "ChromeProfile");
                    browserProcess = Process.Start(new ProcessStartInfo
                    {
                        FileName = chromePath,
                        Arguments = "--app=" + url + " --user-data-dir=\"" + profileDir + "\"",
                        UseShellExecute = false
                    });
                    return;
                }

                // Fallback to default browser
                Process.Start(url);
            }
            catch (Exception ex)
            {
                try { Process.Start(url); }
                catch
                {
                    MessageBox.Show("Could not open browser for " + url + ":\n" + ex.Message, "Draftline");
                }
            }
        }

        private static void Cleanup()
        {
            try
            {
                if (trayIcon != null)
                {
                    trayIcon.Visible = false;
                    trayIcon.Dispose();
                    trayIcon = null;
                }
            }
            catch { }

            try
            {
                if (serverProcess != null && !serverProcess.HasExited)
                {
                    serverProcess.Kill();
                    serverProcess.WaitForExit(1000);
                    serverProcess = null;
                }
            }
            catch { }
        }

        private static string FindOnPath(string exeName)
        {
            string pathEnv = Environment.GetEnvironmentVariable("PATH");
            if (string.IsNullOrEmpty(pathEnv)) return null;

            string[] paths = pathEnv.Split(Path.PathSeparator);
            foreach (string p in paths)
            {
                try
                {
                    string full = Path.Combine(p.Trim(), exeName);
                    if (File.Exists(full)) return full;
                }
                catch { }
            }
            return null;
        }
    }
}
