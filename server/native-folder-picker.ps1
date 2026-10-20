$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class CodexFolderPicker {
  [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
  private class FileOpenDialog { }

  [ComImport, Guid("D57C7288-D4AD-4768-BE02-9D969532D960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IFileOpenDialog {
    [PreserveSig] int Show(IntPtr owner);
    void SetFileTypes(uint count, IntPtr filters);
    void SetFileTypeIndex(uint index);
    void GetFileTypeIndex(out uint index);
    void Advise(IntPtr events, out uint cookie);
    void Unadvise(uint cookie);
    void SetOptions(uint options);
    void GetOptions(out uint options);
    void SetDefaultFolder(IShellItem folder);
    void SetFolder(IShellItem folder);
    void GetFolder(out IShellItem folder);
    void GetCurrentSelection(out IShellItem item);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetFileName(out IntPtr name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void GetResult(out IShellItem item);
  }

  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItem {
    void BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, out IntPtr result);
    void GetParent(out IShellItem parent);
    void GetDisplayName(uint kind, out IntPtr name);
    void GetAttributes(uint mask, out uint attributes);
    void Compare(IShellItem other, uint hint, out int order);
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
  private static extern int SHCreateItemFromParsingName(string path, IntPtr context, ref Guid iid, out IShellItem item);
  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();

  public static string Choose(string initialPath) {
    IFileOpenDialog dialog = (IFileOpenDialog)new FileOpenDialog();
    IShellItem selected = null;
    try {
      uint options;
      dialog.GetOptions(out options);
      // Pick folders from the filesystem; keep the process cwd and recent list unchanged.
      dialog.SetOptions(options | 0x20 | 0x40 | 0x800 | 0x8 | 0x02000000);
      dialog.SetTitle("Open project folder");
      dialog.SetOkButtonLabel("Open folder");
      if (Directory.Exists(initialPath)) {
        Guid iid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
        IShellItem folder;
        if (SHCreateItemFromParsingName(initialPath, IntPtr.Zero, ref iid, out folder) == 0) {
          try { dialog.SetFolder(folder); }
          finally { Marshal.ReleaseComObject(folder); }
        }
      }
      int result = dialog.Show(GetForegroundWindow());
      if (result == unchecked((int)0x800704C7)) return null;
      if (result != 0) Marshal.ThrowExceptionForHR(result);
      dialog.GetResult(out selected);
      IntPtr name;
      selected.GetDisplayName(0x80058000, out name);
      try { return Marshal.PtrToStringUni(name); }
      finally { Marshal.FreeCoTaskMem(name); }
    } finally {
      if (selected != null) Marshal.ReleaseComObject(selected);
      Marshal.ReleaseComObject(dialog);
    }
  }
}
'@
  $chosenFolder = [CodexFolderPicker]::Choose($env:CODEX_LOCAL_PICKER_INITIAL)
  [Console]::Out.WriteLine(([pscustomobject]@{
    path = $chosenFolder
    cancelled = ($null -eq $chosenFolder)
  } | ConvertTo-Json -Compress))
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
