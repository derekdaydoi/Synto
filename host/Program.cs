// Synto desktop host: a WinForms window with WebView2 that serves the bundled web app.
// Written for the C# 5 compiler that ships with .NET Framework 4.x (no C# 6+ syntax).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("Synto")]
[assembly: AssemblyProduct("Synto")]
[assembly: AssemblyDescription("Synto - ghi chú trên mặt giấy vô tận")]
[assembly: AssemblyVersion("0.1.0.0")]
[assembly: AssemblyFileVersion("0.1.0.0")]

namespace Synto
{
    internal static class Program
    {
        internal const string HostName = "synto.app";
        internal const long MaxFileBytes = 80L * 1024 * 1024;

        internal static string DataRootOverride;

        internal static string DataRoot
        {
            get { return DataRootOverride ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Synto"); }
        }

        [STAThread]
        private static void Main(string[] args)
        {
            AppDomain.CurrentDomain.AssemblyResolve += ResolveEmbeddedAssembly;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.ThreadException += (s, e) => ShowFatal(e.Exception);
            AppDomain.CurrentDomain.UnhandledException += (s, e) => ShowFatal(e.ExceptionObject as Exception);
            try
            {
                // Developer flags (ignored unless --dev is given):
                //   --dev <app folder>   serve the web app from source instead of the embedded copy
                //   --script <file.js>   run a script after the page loads (smoke tests)
                //   --data <folder>      use a separate data profile (keeps tests away from real notes)
                string devFolder = null, script = null, data = null;
                for (int i = 0; i < args.Length - 1; i++)
                {
                    if (args[i] == "--dev") devFolder = Path.GetFullPath(args[i + 1]);
                    else if (args[i] == "--script") script = Path.GetFullPath(args[i + 1]);
                    else if (args[i] == "--data") data = Path.GetFullPath(args[i + 1]);
                }
                if (devFolder == null) { script = null; data = null; }
                if (data != null) DataRootOverride = data;
                Run(devFolder, script);
            }
            catch (Exception ex)
            {
                ShowFatal(ex);
            }
        }

        // Kept in a separate method so WebView2 types load only after AssemblyResolve is hooked.
        private static void Run(string devFolder, string script)
        {
            string appDir = devFolder ?? ExtractApp();
            string loaderDir = ExtractLoader();
            CoreWebView2Environment.SetLoaderDllFolderPath(loaderDir);
            if (!RuntimeAvailable()) return;
            Application.Run(new MainForm(appDir, devFolder != null, script));
        }

        private static bool RuntimeAvailable()
        {
            try
            {
                string v = CoreWebView2Environment.GetAvailableBrowserVersionString();
                if (!string.IsNullOrEmpty(v)) return true;
            }
            catch (Exception) { }
            DialogResult r = MessageBox.Show(
                "Synto cần Microsoft Edge WebView2 Runtime (có sẵn trên Windows 11).\n\nMở trang tải về của Microsoft?",
                "Synto", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
            if (r == DialogResult.Yes)
                Process.Start(new ProcessStartInfo("https://go.microsoft.com/fwlink/p/?LinkId=2124703") { UseShellExecute = true });
            return false;
        }

        private static Assembly ResolveEmbeddedAssembly(object sender, ResolveEventArgs e)
        {
            string name = new AssemblyName(e.Name).Name;
            if (name != "Microsoft.Web.WebView2.Core" && name != "Microsoft.Web.WebView2.WinForms") return null;
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Synto.lib." + name + ".dll"))
            {
                if (s == null) return null;
                byte[] bytes = new byte[s.Length];
                int read = 0;
                while (read < bytes.Length) read += s.Read(bytes, read, bytes.Length - read);
                return Assembly.Load(bytes);
            }
        }

        private static byte[] ReadResource(string name)
        {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
            {
                if (s == null) throw new InvalidOperationException("Thiếu tài nguyên: " + name);
                using (MemoryStream ms = new MemoryStream())
                {
                    s.CopyTo(ms);
                    return ms.ToArray();
                }
            }
        }

        private static string ShortHash(byte[] data)
        {
            using (SHA256 sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(data)).Replace("-", "").Substring(0, 16).ToLowerInvariant();
        }

        /// Extracts the embedded web app once per version into %LOCALAPPDATA%\Synto\app\<hash>.
        private static string ExtractApp()
        {
            byte[] zip = ReadResource("Synto.app.zip");
            string root = Path.Combine(DataRoot, "app");
            string target = Path.Combine(root, ShortHash(zip));
            string marker = Path.Combine(target, ".complete");
            if (!File.Exists(marker))
            {
                string temp = target + ".tmp-" + Process.GetCurrentProcess().Id;
                if (Directory.Exists(temp)) Directory.Delete(temp, true);
                Directory.CreateDirectory(temp);
                string zipPath = Path.Combine(temp, "..", Path.GetFileName(temp) + ".zip");
                File.WriteAllBytes(zipPath, zip);
                try { ZipFile.ExtractToDirectory(zipPath, temp); }
                finally { File.Delete(zipPath); }
                File.WriteAllText(Path.Combine(temp, ".complete"), DateTime.UtcNow.ToString("o"));
                if (Directory.Exists(target)) Directory.Delete(target, true);
                Directory.Move(temp, target);
            }
            // Best effort: remove older versions.
            try
            {
                foreach (string d in Directory.GetDirectories(root))
                    if (!string.Equals(d, target, StringComparison.OrdinalIgnoreCase)) Directory.Delete(d, true);
            }
            catch (Exception) { }
            return target;
        }

        private static string ProcessArch()
        {
            string a = (Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE") ?? "").ToUpperInvariant();
            if (a == "ARM64") return "arm64";
            return Environment.Is64BitProcess ? "x64" : "x86";
        }

        /// The native WebView2Loader.dll must exist on disk; write the one matching this process.
        private static string ExtractLoader()
        {
            string arch = ProcessArch();
            byte[] dll = ReadResource("Synto.loader." + arch + ".WebView2Loader.dll");
            string dir = Path.Combine(DataRoot, "runtime", ShortHash(dll), arch);
            string path = Path.Combine(dir, "WebView2Loader.dll");
            if (!File.Exists(path))
            {
                Directory.CreateDirectory(dir);
                string temp = path + ".tmp";
                File.WriteAllBytes(temp, dll);
                if (File.Exists(path)) File.Delete(temp); else File.Move(temp, path);
            }
            return dir;
        }

        internal static void ShowFatal(Exception ex)
        {
            if (ex == null) return;
            try
            {
                Directory.CreateDirectory(DataRoot);
                File.AppendAllText(Path.Combine(DataRoot, "error.log"), DateTime.Now.ToString("o") + " " + ex + Environment.NewLine);
            }
            catch (Exception) { }
            MessageBox.Show("Synto gặp lỗi:\n\n" + ex.Message + "\n\nChi tiết đã ghi vào %LOCALAPPDATA%\\Synto\\error.log",
                "Synto", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    internal sealed class MainForm : Form
    {
        private readonly string appDir;
        private readonly bool devMode;
        private readonly string script;
        private readonly WebView2 web;
        private readonly JavaScriptSerializer json;
        private bool flushed;
        private bool closeRequested;
        private Timer closeTimer;
        private Icon iconOnLight, iconOnDark, bigIcon, smallIcon;

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
        private const int WM_SETICON = 0x0080, ICON_SMALL = 0, ICON_BIG = 1;
        private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;

        public MainForm(string appDir, bool devMode, string script)
        {
            this.appDir = appDir;
            this.devMode = devMode;
            this.script = script;
            json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 16 };
            Text = "Synto";
            BackColor = Color.White;
            MinimumSize = new Size(360, 480);
            StartPosition = FormStartPosition.Manual;
            AutoScaleMode = AutoScaleMode.Dpi;
            iconOnLight = LoadIcon("Synto.icon.on-light.ico");
            iconOnDark = LoadIcon("Synto.icon.on-dark.ico");
            // The window (title bar) is always light like the app, so its own icon is the dark-ink one.
            if (iconOnLight != null) Icon = iconOnLight;
            RestoreBounds_();
            web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.White };
            Controls.Add(web);
            Shown += async (s, e) => { ApplyThemeIcons(); await InitAsync(); };
            FormClosing += OnFormClosing;
            SystemEvents.UserPreferenceChanged += OnUserPreferenceChanged;
        }

        private static Icon LoadIcon(string resource)
        {
            try
            {
                using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(resource))
                    return s == null ? null : new Icon(s);
            }
            catch (Exception) { return null; }
        }

        /// Windows taskbar / Alt+Tab follow the *system* theme: use the white mark when it is dark.
        private static bool SystemUsesLightTheme()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                {
                    object v = k == null ? null : k.GetValue("SystemUsesLightTheme");
                    return !(v is int) || (int)v != 0;
                }
            }
            catch (Exception) { return true; }
        }

        private void ApplyThemeIcons()
        {
            if (!IsHandleCreated) return;
            // Keep the title bar light even when apps are set to dark mode.
            int light = 0;
            try { DwmSetWindowAttribute(Handle, DWMWA_USE_IMMERSIVE_DARK_MODE, ref light, sizeof(int)); } catch (Exception) { }
            Icon src = SystemUsesLightTheme() ? iconOnLight : iconOnDark;
            if (src == null) return;
            Icon next = new Icon(src, SystemInformation.IconSize);
            SendMessage(Handle, WM_SETICON, (IntPtr)ICON_BIG, next.Handle);
            if (bigIcon != null) bigIcon.Dispose();
            bigIcon = next;
            if (smallIcon == null && iconOnLight != null) smallIcon = new Icon(iconOnLight, SystemInformation.SmallIconSize);
            if (smallIcon != null) SendMessage(Handle, WM_SETICON, (IntPtr)ICON_SMALL, smallIcon.Handle);
        }

        private void OnUserPreferenceChanged(object sender, UserPreferenceChangedEventArgs e)
        {
            if (e.Category == UserPreferenceCategory.General || e.Category == UserPreferenceCategory.VisualStyle || e.Category == UserPreferenceCategory.Color)
            {
                if (IsHandleCreated) BeginInvoke(new Action(ApplyThemeIcons));
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            ApplyThemeIcons();
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            // SystemEvents is static: always unsubscribe to avoid leaking the form.
            SystemEvents.UserPreferenceChanged -= OnUserPreferenceChanged;
            base.OnFormClosed(e);
        }

        private async Task InitAsync()
        {
            try
            {
                string userData = Path.Combine(Program.DataRoot, "WebView2");
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, userData, null);
                await web.EnsureCoreWebView2Async(env);
                CoreWebView2 core = web.CoreWebView2;
                // The UI is always light, regardless of the Windows app theme.
                core.Profile.PreferredColorScheme = CoreWebView2PreferredColorScheme.Light;
                CoreWebView2Settings st = core.Settings;
                st.AreDevToolsEnabled = devMode;
                st.IsStatusBarEnabled = false;
                st.IsZoomControlEnabled = false;
                st.IsPinchZoomEnabled = false;
                st.AreBrowserAcceleratorKeysEnabled = devMode;
                st.IsPasswordAutosaveEnabled = false;
                st.IsGeneralAutofillEnabled = false;
                st.AreHostObjectsAllowed = false;
                st.IsWebMessageEnabled = true;
                core.SetVirtualHostNameToFolderMapping(Program.HostName, appDir, CoreWebView2HostResourceAccessKind.Deny);
                core.NewWindowRequested += (s, e) => { e.Handled = true; };
                core.NavigationStarting += (s, e) =>
                {
                    if (!e.Uri.StartsWith("https://" + Program.HostName + "/", StringComparison.OrdinalIgnoreCase)) e.Cancel = true;
                };
                core.DownloadStarting += (s, e) => { e.Cancel = true; };
                core.PermissionRequested += (s, e) => { e.State = CoreWebView2PermissionState.Deny; };
                core.WebMessageReceived += OnWebMessage;
                if (devMode && script != null && File.Exists(script))
                {
                    string code = File.ReadAllText(script);
                    bool ran = false;
                    core.NavigationCompleted += async (s, e) =>
                    {
                        if (ran || !e.IsSuccess) return;
                        ran = true;
                        await core.ExecuteScriptAsync(code);
                    };
                }
                core.Navigate("https://" + Program.HostName + "/index.html");
            }
            catch (Exception ex)
            {
                Program.ShowFatal(ex);
                Close();
            }
        }

        private void Post(Dictionary<string, object> msg)
        {
            if (web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsJson(json.Serialize(msg));
        }

        private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            Dictionary<string, object> msg;
            try { msg = json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson); }
            catch (Exception) { return; }
            if (msg == null) return;
            string type = Str(msg, "type");
            string requestId = Str(msg, "requestId");
            var reply = new Dictionary<string, object>();
            reply["requestId"] = requestId;
            try
            {
                switch (type)
                {
                    case "title":
                        string t = Str(msg, "title");
                        Text = string.IsNullOrEmpty(t) ? "Synto" : (t.Length > 200 ? t.Substring(0, 200) : t);
                        return;
                    case "openExternal":
                        // Only the project's GitHub links may leave the app (opened in the default browser).
                        Uri uri;
                        string link = Str(msg, "url");
                        if (Uri.TryCreate(link, UriKind.Absolute, out uri) && uri.Scheme == Uri.UriSchemeHttps &&
                            string.Equals(uri.Host, "github.com", StringComparison.OrdinalIgnoreCase))
                            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
                        return;
                    case "flushed":
                        flushed = true;
                        if (closeRequested) BeginInvoke(new Action(Close));
                        return;
                    case "saveFile":
                        SaveFile(msg, reply);
                        break;
                    case "openFile":
                        OpenFile(msg, reply);
                        break;
                    default:
                        return;
                }
            }
            catch (Exception ex)
            {
                reply["ok"] = false;
                reply["error"] = "Lỗi: " + ex.Message;
            }
            if (!string.IsNullOrEmpty(requestId)) Post(reply);
        }

        private static string Str(Dictionary<string, object> m, string k)
        {
            object v;
            return m.TryGetValue(k, out v) && v != null ? v.ToString() : null;
        }

        private static string SafeExt(string ext)
        {
            if (string.IsNullOrEmpty(ext)) return "bin";
            foreach (char c in ext) if (!char.IsLetterOrDigit(c)) return "bin";
            return ext.Length > 10 ? "bin" : ext.ToLowerInvariant();
        }

        private void SaveFile(Dictionary<string, object> msg, Dictionary<string, object> reply)
        {
            string ext = SafeExt(Str(msg, "extension"));
            string filterName = Str(msg, "filterName") ?? ext.ToUpperInvariant();
            string name = Path.GetFileName(Str(msg, "name") ?? ("synto." + ext));
            foreach (char c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '_');
            byte[] data = Convert.FromBase64String(Str(msg, "base64") ?? "");
            using (var dlg = new SaveFileDialog())
            {
                dlg.Filter = filterName.Replace("|", " ") + " (*." + ext + ")|*." + ext;
                dlg.DefaultExt = ext;
                dlg.AddExtension = true;
                dlg.OverwritePrompt = true;
                dlg.FileName = name;
                if (dlg.ShowDialog(this) != DialogResult.OK) { reply["ok"] = false; reply["cancelled"] = true; return; }
                // Write to a temp file first so a failure never leaves a half-written document.
                string temp = dlg.FileName + ".synto-tmp";
                File.WriteAllBytes(temp, data);
                if (File.Exists(dlg.FileName)) File.Replace(temp, dlg.FileName, null);
                else File.Move(temp, dlg.FileName);
                reply["ok"] = true;
                reply["name"] = Path.GetFileName(dlg.FileName);
            }
        }

        private void OpenFile(Dictionary<string, object> msg, Dictionary<string, object> reply)
        {
            var exts = new List<string>();
            object raw;
            if (msg.TryGetValue("extensions", out raw) && raw is System.Collections.IEnumerable)
                foreach (object o in (System.Collections.IEnumerable)raw) if (o != null) exts.Add(SafeExt(o.ToString()));
            if (exts.Count == 0) exts.Add("synto");
            string pattern = "*." + string.Join(";*.", exts.ToArray());
            string filterName = (Str(msg, "filterName") ?? "Tệp").Replace("|", " ");
            using (var dlg = new OpenFileDialog())
            {
                dlg.Filter = filterName + " (" + pattern + ")|" + pattern;
                dlg.CheckFileExists = true;
                dlg.Multiselect = false;
                if (dlg.ShowDialog(this) != DialogResult.OK) { reply["ok"] = false; reply["cancelled"] = true; return; }
                var info = new FileInfo(dlg.FileName);
                if (info.Length > Program.MaxFileBytes) { reply["ok"] = false; reply["error"] = "File quá lớn (tối đa 80 MB)."; return; }
                reply["ok"] = true;
                reply["name"] = info.Name;
                reply["mime"] = MimeOf(info.Extension);
                reply["base64"] = Convert.ToBase64String(File.ReadAllBytes(dlg.FileName));
            }
        }

        private static string MimeOf(string ext)
        {
            switch ((ext ?? "").ToLowerInvariant())
            {
                case ".png": return "image/png";
                case ".jpg": case ".jpeg": return "image/jpeg";
                case ".gif": return "image/gif";
                case ".webp": return "image/webp";
                case ".svg": return "image/svg+xml";
                case ".pdf": return "application/pdf";
                case ".synto": case ".json": return "application/json";
                default: return "application/octet-stream";
            }
        }

        // Ask the page to save its state before the window closes (with a timeout fallback).
        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            SaveBounds();
            if (flushed || web.CoreWebView2 == null) return;
            e.Cancel = true;
            if (closeRequested) return;
            closeRequested = true;
            var msg = new Dictionary<string, object>();
            msg["type"] = "flush";
            Post(msg);
            closeTimer = new Timer { Interval = 3000 };
            closeTimer.Tick += (s, a) => { closeTimer.Stop(); flushed = true; Close(); };
            closeTimer.Start();
        }

        private string BoundsFile { get { return Path.Combine(Program.DataRoot, "window.txt"); } }

        private void RestoreBounds_()
        {
            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            Rectangle r = new Rectangle(wa.X + wa.Width / 10, wa.Y + wa.Height / 12, wa.Width * 4 / 5, wa.Height * 5 / 6);
            bool maximized = false;
            try
            {
                if (File.Exists(BoundsFile))
                {
                    string[] p = File.ReadAllText(BoundsFile).Split(',');
                    if (p.Length >= 5)
                    {
                        var saved = new Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
                        // Only use it if it is still visible on some screen.
                        foreach (Screen s in Screen.AllScreens)
                            if (s.WorkingArea.IntersectsWith(saved) && saved.Width >= 360 && saved.Height >= 480) { r = saved; break; }
                        maximized = p[4] == "1";
                    }
                }
            }
            catch (Exception) { }
            Bounds = r;
            if (maximized) WindowState = FormWindowState.Maximized;
        }

        private void SaveBounds()
        {
            try
            {
                Directory.CreateDirectory(Program.DataRoot);
                Rectangle r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
                File.WriteAllText(BoundsFile, string.Format("{0},{1},{2},{3},{4}", r.X, r.Y, r.Width, r.Height, WindowState == FormWindowState.Maximized ? 1 : 0));
            }
            catch (Exception) { }
        }
    }
}
