"use strict";

// The asking installer: the NSIS include config() gives electron-builder, made
// from the app's file types and right-click entry. It never claims a file type,
// adds a right-click entry or makes a shortcut without asking (WORKQUEUE 8d):
//
// - who it's for: electron-builder's own page, "Only for me" (no
//   administrator prompt) or everyone. If the app is already installed for
//   everyone, the page is skipped and that copy is upgraded, so an install
//   from before the kit (which was always for everyone) never becomes two;
// - Choose File Types: MUI's Components page, a branch per file type group, as
//   the app names it, expanded, with a box per extension, all ticked. An app
//   that takes any file (allFiles), or none, has no such page;
// - Shortcuts & Right-Click Menu: a ticked box each for the desktop shortcut,
//   the Start menu shortcut and the right-click entry ("Shortcuts" for an app
//   without one);
// - a ticked type: the app is in its Open With list, and it's listed as an
//   app in Windows' Default apps (Capabilities, RegisteredApplications). It
//   becomes the type's default only where no app has been chosen: Windows
//   keeps each person's own choice (UserChoice) where no installer can write
//   it, and another app's default is never taken. An unticked type gets
//   nothing, and what an earlier install added for it is taken away;
// - the choices are kept with the install, and the next install starts from
//   them: an update (silent, run by the updater) shows no page, never adds
//   back what was unticked and never makes a shortcut. Silently,
//   /FILETYPES=all, none or a list (txt,md), /NOCONTEXTMENU,
//   /NODESKTOPSHORTCUT (or electron-builder's --no-desktop-shortcut) and
//   /NOSTARTMENUSHORTCUT choose instead;
// - uninstalling takes away everything it added; an update's uninstall of
//   the version before it (--updated) takes away nothing. That includes the
//   updater's cache (a copy of the installer and any update it downloaded),
//   which electron-builder's own uninstaller leaves;
// - the installer opens on a welcome page saying what it will ask, and the
//   uninstaller's says what it does, with an unticked "Also remove settings
//   and logs" box: ticked, it removes the app's data as electron-builder's
//   --delete-app-data does. A silent uninstall keeps it unless given
//   --delete-app-data, and an update's uninstall always keeps it.
//
// electron-builder builds it with makensis -WX: a warning fails the build, so
// what the uninstaller doesn't use is never compiled into it.

/**
 * The longest right-click label the page's line holds: 'Add "<label>" to the
 * right-click menu' wraps past about ninety characters, and a checkbox one line
 * high shows the middle of two lines, clipped top and bottom.
 */
const MAX_LABEL = 48;

/** A string inside NSIS's double quotes. */
function nsisString(text) {
    return String(text)
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\$/g, "$$$$")
        .replace(/"/g, '$\\"')
        .replace(/`/g, "$\\`");
}

/** A control's label: & would underline the next letter. */
function controlText(text) {
    return nsisString(text).replace(/&/g, "&&");
}

/**
 * How many sections the Choose File Types page declares: a group counts twice
 * (its start and its end) and each extension once. electron-builder's own
 * "install" section comes after them, at this index.
 */
function sectionCount(fileTypes) {
    return fileTypes.reduce((count, group) => count + group.ext.length + 2, 0);
}

/**
 * The welcome pages: the installer's says what it will ask; the
 * uninstaller's what it does, with the box for the app's data under its text.
 * @param {string} product the app's name, as a label shows it
 * @param {boolean} hasFileTypes whether the installer asks which files it opens
 */
function welcomePages(product, hasFileTypes) {
    const asks = hasFileTypes ? "who it's for, the files it opens and its shortcuts" : "who it's for and its shortcuts";
    return [
        "!macro customWelcomePage",
        `  !define MUI_WELCOMEPAGE_TITLE "Welcome to ${product} Setup"`,
        `  !define MUI_WELCOMEPAGE_TEXT "This installs ${product} \${VERSION} on your computer. You'll choose ${asks}.$\\r$\\n$\\r$\\nClick Next to continue."`,
        "  !define MUI_PAGE_CUSTOMFUNCTION_PRE KitWelcomePage",
        "  !insertmacro MUI_PAGE_WELCOME",
        "",
        "  Function KitWelcomePage",
        "    ${if} ${isUpdated}",
        "      Abort",
        "    ${endIf}",
        "  FunctionEnd",
        "!macroend",
        "",
        "!macro customUnWelcomePage",
        "  Var KitRemoveDataBox",
        "  Var KitRemoveData",
        `  !define MUI_WELCOMEPAGE_TITLE "Uninstall ${product}"`,
        `  !define MUI_WELCOMEPAGE_TEXT "This removes ${product} from your computer. Close it first if it's open."`,
        "  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.KitUnWelcomeShow",
        "  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE un.KitUnWelcomeLeave",
        "  !insertmacro MUI_UNPAGE_WELCOME",
        "",
        // MUI's text fills the page's height, so the box would sit under it: the text is cut to the lines it takes, measured in its own font.
        "  Function un.KitUnWelcomeShow",
        ...["$0", "$1", "$2", "$3", "$4", "$5", "$6", "$7", "$8", "$9"].map((register) => `    Push ${register}`),
        "    System::Call '*(i, i, i, i) p .r0'",
        "    System::Call 'user32::GetWindowRect(p $mui.WelcomePage.Text, p r0)'",
        "    System::Call 'user32::MapWindowPoints(p 0, p $mui.WelcomePage, p r0, i 2)'",
        // $1 and $2 its left and top, $3 its width.
        "    System::Call '*$0(i .r1, i .r2, i .r3, i)'",
        "    IntOp $3 $3 - $1",
        "    SendMessage $mui.WelcomePage.Text ${WM_GETFONT} 0 0 $4",
        "    System::Call 'user32::GetDC(p $mui.WelcomePage.Text) p .r5'",
        "    System::Call 'gdi32::SelectObject(p r5, p r4) p .r6'",
        // DT_CALCRECT | DT_WORDBREAK: $7 the text's height at that width, $8 a line's.
        "    ${NSD_GetText} $mui.WelcomePage.Text $7",
        "    System::Call '*$0(i 0, i 0, i r3, i 0)'",
        "    System::Call 'user32::DrawText(p r5, t r7, i -1, p r0, i 0x410) i .r7'",
        "    System::Call '*$0(i 0, i 0, i r3, i 0)'",
        "    System::Call 'user32::DrawText(p r5, t \"A\", i -1, p r0, i 0x410) i .r8'",
        "    System::Call 'gdi32::SelectObject(p r5, p r6)'",
        "    System::Call 'user32::ReleaseDC(p $mui.WelcomePage.Text, p r5)'",
        // SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE.
        "    System::Call 'user32::SetWindowPos(p $mui.WelcomePage.Text, p 0, i 0, i 0, i r3, i r7, i 0x16)'",
        // A line below the text, the box; a line below the box, the page's last line.
        "    IntOp $2 $2 + $7",
        "    IntOp $2 $2 + $8",
        '    ${NSD_CreateCheckbox} 0 0 195u 10u "Also remove settings and logs"',
        "    Pop $KitRemoveDataBox",
        '    SetCtlColors $KitRemoveDataBox "${MUI_TEXTCOLOR}" "${MUI_BGCOLOR}"',
        // SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE.
        "    System::Call 'user32::SetWindowPos(p $KitRemoveDataBox, p 0, i r1, i r2, i 0, i 0, i 0x15)'",
        "    System::Call 'user32::GetWindowRect(p $KitRemoveDataBox, p r0)'",
        "    System::Call '*$0(i, i .r6, i, i .r9)'",
        "    IntOp $9 $9 - $6",
        "    IntOp $2 $2 + $9",
        "    IntOp $2 $2 + $8",
        "    System::Free $0",
        '    ${NSD_CreateLabel} 0 0 195u 10u "Click Next to continue."',
        "    Pop $0",
        '    SetCtlColors $0 "${MUI_TEXTCOLOR}" "${MUI_BGCOLOR}"',
        "    System::Call 'user32::SetWindowPos(p r0, p 0, i r1, i r2, i r3, i r8, i 0x14)'",
        ...["$9", "$8", "$7", "$6", "$5", "$4", "$3", "$2", "$1", "$0"].map((register) => `    Pop ${register}`),
        "  FunctionEnd",
        "",
        "  Function un.KitUnWelcomeLeave",
        "    ${NSD_GetState} $KitRemoveDataBox $KitRemoveData",
        "  FunctionEnd",
        "!macroend",
    ];
}

/**
 * Uninstalling takes away everything it may have added, and the updater's
 * cache; an update's uninstall, nothing. With the welcome page's box ticked,
 * the app's data too.
 * @param {string[]} removals what the pages' choices added, indented for the block
 */
function uninstall(removals) {
    return [
        "!macro customUnInstall",
        "  ${ifNot} ${isUpdated}",
        ...removals,
        // The welcome page's box, or electron-builder's --delete-app-data (it removes the same folders after this, once, with no second try).
        "    ClearErrors",
        "    ${GetParameters} $R0",
        '    ${GetOptions} $R0 "--delete-app-data" $R1',
        "    ${ifNot} ${Errors}",
        '      StrCpy $KitRemoveData "1"',
        "    ${endIf}",
        // The person's own app data, even for everyone.
        '    ${if} $KitRemoveData == "1"',
        '      ${if} $installMode == "all"',
        "        SetShellVarContext current",
        "      ${endIf}",
        '      !insertmacro KitRemoveFolder "$APPDATA\\${APP_FILENAME}"',
        "      !ifdef APP_PRODUCT_FILENAME",
        '        !insertmacro KitRemoveFolder "$APPDATA\\${APP_PRODUCT_FILENAME}"',
        "      !endif",
        "      !ifdef APP_PACKAGE_NAME",
        '        !insertmacro KitRemoveFolder "$APPDATA\\${APP_PACKAGE_NAME}"',
        "      !endif",
        '      ${if} $installMode == "all"',
        "        SetShellVarContext all",
        "      ${endIf}",
        "    ${endIf}",
        // electron-builder's install copies itself there, and electron-updater downloads there: the person's own app data, even for everyone.
        "    !ifdef APP_INSTALLER_STORE_FILE",
        '      ${if} $installMode == "all"',
        "        SetShellVarContext current",
        "      ${endIf}",
        '      ${GetParent} "$LOCALAPPDATA\\${APP_INSTALLER_STORE_FILE}" $R0',
        // Only ever the cache's own folder.
        '      StrCpy $R1 $R0 "" -8',
        '      ${if} $R1 == "-updater"',
        '        RMDir /r "$R0"',
        "      ${endIf}",
        '      ${if} $installMode == "all"',
        "        SetShellVarContext all",
        "      ${endIf}",
        "    !endif",
        "  ${endIf}",
        "!macroend",
        "",
        // A folder and all in it. A file just deleted can keep its folder for a moment (a virus scan, the search indexer), so it's tried for up to five seconds.
        "!macro KitRemoveFolder FOLDER",
        "  StrCpy $R2 0",
        "  ${do}",
        '    RMDir /r "${FOLDER}"',
        '    ${ifNot} ${FileExists} "${FOLDER}\\*.*"',
        "    ${orIf} $R2 >= 10",
        "      ${break}",
        "    ${endIf}",
        "    IntOp $R2 $R2 + 1",
        "    Sleep 500",
        "  ${loop}",
        "!macroend",
    ];
}

/**
 * A shortcut matched to its box, after electron-builder's install has made
 * (or, over an existing install, kept) it. A ticked one that's missing is made
 * as electron-builder makes it; an unticked one is taken away. An update never
 * makes one, and takes away only what electron-builder made just now ($keepShortcuts
 * "false"), so it never brings back or undoes what the person did by hand.
 */
function matchShortcut(choice, link, makeFolder, removeFolder) {
    return [
        `  \${if} ${choice} == "1"`,
        "    ${ifNot} ${isUpdated}",
        `    \${andIfNot} \${FileExists} "${link}"`,
        ...makeFolder.map((line) => `      ${line}`),
        `      CreateShortCut "${link}" "$appExe" "" "$appExe" 0 "" "" "\${APP_DESCRIPTION}"`,
        "      ClearErrors",
        `      WinShell::SetLnkAUMI "${link}" "\${APP_ID}"`,
        "    ${endIf}",
        "  ${else}",
        "    ${ifNot} ${isUpdated}",
        '    ${orIf} $keepShortcuts == "false"',
        `      WinShell::UninstShortcut "${link}"`,
        `      Delete "${link}"`,
        ...removeFolder.map((line) => `      ${line}`),
        "    ${endIf}",
        "  ${endIf}",
    ];
}

/**
 * The NSIS include for an app.
 * @param {{
 *   productName: string,
 *   description?: string,
 *   fileTypes: { name: string, ext: string[] }[],
 *   contextMenu?: { label: string, folders?: boolean, args?: string[] },
 * }} app
 */
function installerScript({ productName, description = "", fileTypes, contextMenu }) {
    const key = productName.replace(/[^A-Za-z0-9]/g, "");
    const product = nsisString(productName);
    const exts = fileTypes.flatMap((group) => group.ext);
    const progId = (ext) => `${key}.${ext}`;
    const sections = sectionCount(fileTypes);
    const capabilities = `Software\\Diamond Digital Development\\${key}\\Capabilities`;
    const menuKeys = contextMenu ? [`Software\\Classes\\*\\shell\\${key}`, ...(contextMenu.folders ? [`Software\\Classes\\Directory\\shell\\${key}`] : [])] : [];
    const menuCommand = contextMenu ? `"$appExe" "%1"${(contextMenu.args ?? []).map((arg) => ` ${arg}`).join("")}` : "";

    /** Take away what a ticked type added. */
    const unassociate = (ext, indent) => [
        `DeleteRegValue SHELL_CONTEXT "Software\\Classes\\.${ext}\\OpenWithProgids" "${progId(ext)}"`,
        `ReadRegStr $R9 SHELL_CONTEXT "Software\\Classes\\.${ext}" ""`,
        `\${if} $R9 == "${progId(ext)}"`,
        `  DeleteRegValue SHELL_CONTEXT "Software\\Classes\\.${ext}" ""`,
        "${endIf}",
        // The .ext key and its OpenWithProgids stay: /ifempty counts only subkeys, so it would take other apps' values with them.
        `DeleteRegKey SHELL_CONTEXT "Software\\Classes\\${progId(ext)}"`,
    ].map((line) => indent + line);

    const removeAll = (indent) => [
        ...exts.flatMap((ext) => unassociate(ext, indent)),
        ...(exts.length > 0
            ? [
                  `${indent}DeleteRegValue SHELL_CONTEXT "Software\\RegisteredApplications" "${product}"`,
                  `${indent}DeleteRegKey SHELL_CONTEXT "Software\\Diamond Digital Development\\${key}"`,
                  `${indent}DeleteRegKey /ifempty SHELL_CONTEXT "Software\\Diamond Digital Development"`,
              ]
            : []),
        ...menuKeys.map((menuKey) => `${indent}DeleteRegKey SHELL_CONTEXT "${menuKey}"`),
    ];

    const lines = [
        "; Made by @diamonddigitaldev/electron-kit's config() (builder/installer.js). Don't edit: it's made afresh on every build.",
        "",
        "!include Sections.nsh",
        "",
        // An install for everyone already there is upgraded, never joined by a second for one person.
        "!macro customInstallMode",
        "  !ifndef BUILD_UNINSTALLER",
        '    ${if} $hasPerMachineInstallation == "1"',
        '      StrCpy $isForceMachineInstall "1"',
        "    ${endIf}",
        "  !endif",
        "!macroend",
        "",
        ...welcomePages(controlText(productName), exts.length > 0),
    ];

    // The pages, their state and what installing does with it: the installer's alone.
    lines.push(
        "",
        "!macro customPageAfterChangeDir",
        "  Var KitDesktopBox",
        "  Var KitDesktop",
        "  Var KitStartMenuBox",
        "  Var KitStartMenu",
        ...(contextMenu ? ["  Var KitMenuBox", "  Var KitMenu"] : []),
    );
    if (exts.length > 0) {
        // Choose File Types. Its sections only hold the ticks: they run before the app's files exist, so customInstall reads them.
        lines.push(
            "",
            "  !define MUI_COMPONENTSPAGE_NODESC",
            '  !define MUI_PAGE_HEADER_TEXT "Choose File Types"',
            `  !define MUI_PAGE_HEADER_SUBTEXT "Choose which files ${product} opens."`,
            `  !define MUI_COMPONENTSPAGE_TEXT_TOP "Add ${product} to Open With for the file types ticked below. It opens them by default only where you haven't already chosen an app, which you can change in Settings > Apps > Default apps."`,
            '  !define MUI_COMPONENTSPAGE_TEXT_COMPLIST "Select file types:"',
            "  !define MUI_PAGE_CUSTOMFUNCTION_PRE KitFileTypesPage",
            "  !insertmacro MUI_PAGE_COMPONENTS",
        );
        let i = 0;
        for (const group of fileTypes) {
            lines.push("", `  SectionGroup /e "${nsisString(group.name)}"`);
            for (const ext of group.ext) {
                lines.push(`    Section ".${ext}" KitFileType${i}`, "    SectionEnd");
                i++;
            }
            lines.push("  SectionGroupEnd");
        }
        lines.push(
            "",
            "  Function KitFileTypesPage",
            "    ${if} ${isUpdated}",
            "      Abort",
            "    ${endIf}",
            "  FunctionEnd",
        );
    }

    // Shortcuts & Right-Click Menu.
    const boxes = [
        ["KitDesktop", "Add a desktop shortcut"],
        ["KitStartMenu", "Add a Start menu shortcut"],
        ...(contextMenu ? [["KitMenu", `Add $\\"${controlText(contextMenu.label)}$\\" to the right-click menu`]] : []),
    ];
    lines.push(
        "",
        "  Page custom KitShortcutsPage KitShortcutsPageLeave",
        "",
        "  Function KitShortcutsPage",
        "    ${if} ${isUpdated}",
        "      Abort",
        "    ${endIf}",
        // The header is a label: && shows one &.
        `    !insertmacro MUI_HEADER_TEXT "${contextMenu ? "Shortcuts && Right-Click Menu" : "Shortcuts"}" "Choose where ${product} appears."`,
        "    nsDialogs::Create 1018",
        "    Pop $R0",
        ...boxes.flatMap(([name, label], row) => [
            `    \${NSD_CreateCheckbox} 0u ${row * 14}u 100% 10u "${label}"`,
            `    Pop $${name}Box`,
            `    \${if} $${name} == "1"`,
            `      \${NSD_Check} $${name}Box`,
            "    ${endIf}",
        ]),
        "    nsDialogs::Show",
        "  FunctionEnd",
        "",
        "  Function KitShortcutsPageLeave",
        ...boxes.map(([name]) => `    \${NSD_GetState} $${name}Box $${name}`),
        "  FunctionEnd",
    );
    if (exts.length > 0) {
        // Whether ",mp3," is in ",txt,mp3,": Push the list, Push the item, Call, Pop 1 or 0.
        lines.push(
            "",
            "  Function KitListHas",
            "    Exch $R1",
            "    Exch",
            "    Exch $R0",
            "    Push $R2",
            "    Push $R3",
            "    Push $R4",
            "    StrLen $R2 $R1",
            "    StrCpy $R3 0",
            "    loop:",
            "      StrCpy $R4 $R0 $R2 $R3",
            '      StrCmp $R4 "" absent',
            "      StrCmp $R4 $R1 present",
            "      IntOp $R3 $R3 + 1",
            "      Goto loop",
            "    present:",
            "      StrCpy $R0 1",
            "      Goto done",
            "    absent:",
            "      StrCpy $R0 0",
            "    done:",
            "    Pop $R4",
            "    Pop $R3",
            "    Pop $R2",
            "    Pop $R1",
            "    Exch $R0",
            "  FunctionEnd",
        );
    }
    lines.push("!macroend");

    /** A choice from the last install, else "1"; then "0" for any of its switches. */
    const choice = (name, value, switches) => [
        "  ClearErrors",
        `  ReadRegStr $${name} SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" "${value}"`,
        "  ${if} ${Errors}",
        `    StrCpy $${name} "1"`,
        "  ${endIf}",
        ...switches.flatMap((option) =>
            option.startsWith("${")
                ? [`  \${if} ${option}`, `    StrCpy $${name} "0"`, "  ${endIf}"]
                : ["  ClearErrors", `  \${GetOptions} $R0 "${option}" $R1`, "  ${ifNot} ${Errors}", `    StrCpy $${name} "0"`, "  ${endIf}"],
        ),
    ];

    // Before any page: the last install's choices, else every box ticked; then the command line's.
    lines.push("", "!macro customInit", "  ${GetParameters} $R0");
    if (exts.length > 0) {
        lines.push(
            // electron-builder's own section comes after the kit's: no box for it in the tree (customInstall checks the index).
            `  SectionSetText ${sections} ""`,
            "  ClearErrors",
            '  ${GetOptions} $R0 "/FILETYPES=" $R1',
            "  ${if} ${Errors}",
            '    StrCpy $R1 ""',
            "  ${else}",
            '    StrCpy $R1 ",$R1,"',
            "  ${endIf}",
        );
        exts.forEach((ext, i) => {
            lines.push(
                "  ClearErrors",
                `  ReadRegStr $R2 SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" "KitFileType.${ext}"`,
                "  ${if} ${Errors}",
                '    StrCpy $R2 "1"',
                "  ${endIf}",
                '  ${if} $R1 == ",all,"',
                '    StrCpy $R2 "1"',
                '  ${elseIf} $R1 == ",none,"',
                '    StrCpy $R2 "0"',
                '  ${elseIf} $R1 != ""',
                "    Push $R1",
                `    Push ",${ext},"`,
                "    Call KitListHas",
                "    Pop $R2",
                "  ${endIf}",
                '  ${if} $R2 == "1"',
                `    !insertmacro SelectSection \${KitFileType${i}}`,
                "  ${else}",
                `    !insertmacro UnselectSection \${KitFileType${i}}`,
                "  ${endIf}",
            );
        });
    }
    lines.push(
        ...choice("KitDesktop", "KitDesktopShortcut", ["/NODESKTOPSHORTCUT", "${isNoDesktopShortcut}"]),
        ...choice("KitStartMenu", "KitStartMenuShortcut", ["/NOSTARTMENUSHORTCUT"]),
        ...(contextMenu ? choice("KitMenu", "KitContextMenu", ["/NOCONTEXTMENU"]) : []),
        "!macroend",
    );

    // After the app's files and electron-builder's shortcuts: what's ticked is added, what isn't is taken away, and the choices kept.
    lines.push("", "!macro customInstall");
    if (exts.length > 0) {
        lines.push(
            `  !if \${INSTALL_SECTION_ID} != ${sections}`,
            `    !error "electron-kit: electron-builder's install section is \${INSTALL_SECTION_ID}, not ${sections}, so the Choose File Types page would show it. The kit's installer needs updating for this electron-builder."`,
            "  !endif",
            '  StrCpy $R8 "0"',
            ...exts.flatMap((ext, i) => [
                `  \${if} \${SectionIsSelected} \${KitFileType${i}}`,
                `    WriteRegStr SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" "KitFileType.${ext}" "1"`,
                '    StrCpy $R8 "1"',
                `    WriteRegStr SHELL_CONTEXT "Software\\Classes\\${progId(ext)}" "" "${nsisString(fileTypes.find((group) => group.ext.includes(ext)).name)}"`,
                `    WriteRegStr SHELL_CONTEXT "Software\\Classes\\${progId(ext)}\\DefaultIcon" "" '"$appExe",0'`,
                `    WriteRegStr SHELL_CONTEXT "Software\\Classes\\${progId(ext)}\\shell\\open\\command" "" '"$appExe" "%1"'`,
                `    WriteRegStr SHELL_CONTEXT "Software\\Classes\\.${ext}\\OpenWithProgids" "${progId(ext)}" ""`,
                `    WriteRegStr SHELL_CONTEXT "${capabilities}\\FileAssociations" ".${ext}" "${progId(ext)}"`,
                // The default only where there's none: none set, or one naming a type no app has any more.
                `    ReadRegStr $R9 HKCR ".${ext}" ""`,
                '    ${if} $R9 != ""',
                "      ClearErrors",
                '      EnumRegKey $R7 HKCR "$R9" 0',
                "      ${if} ${Errors}",
                '        StrCpy $R9 ""',
                "      ${endIf}",
                "    ${endIf}",
                '    ${if} $R9 == ""',
                `      WriteRegStr SHELL_CONTEXT "Software\\Classes\\.${ext}" "" "${progId(ext)}"`,
                "    ${endIf}",
                "  ${else}",
                `    WriteRegStr SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" "KitFileType.${ext}" "0"`,
                ...unassociate(ext, "    "),
                `    DeleteRegValue SHELL_CONTEXT "${capabilities}\\FileAssociations" ".${ext}"`,
                "  ${endIf}",
            ]),
            // Listed as an app in Default apps, while it opens any type.
            '  ${if} $R8 == "1"',
            `    WriteRegStr SHELL_CONTEXT "${capabilities}" "ApplicationName" "${product}"`,
            `    WriteRegStr SHELL_CONTEXT "${capabilities}" "ApplicationDescription" "${nsisString(description || productName)}"`,
            `    WriteRegStr SHELL_CONTEXT "Software\\RegisteredApplications" "${product}" "${capabilities}"`,
            "  ${else}",
            `    DeleteRegValue SHELL_CONTEXT "Software\\RegisteredApplications" "${product}"`,
            `    DeleteRegKey SHELL_CONTEXT "Software\\Diamond Digital Development\\${key}"`,
            '    DeleteRegKey /ifempty SHELL_CONTEXT "Software\\Diamond Digital Development"',
            "  ${endIf}",
        );
    }
    lines.push(
        '  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "KitDesktopShortcut" "$KitDesktop"',
        '  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "KitStartMenuShortcut" "$KitStartMenu"',
        ...matchShortcut("$KitDesktop", "$newDesktopLink", [], []),
        ...matchShortcut(
            "$KitStartMenu",
            "$newStartMenuLink",
            ["!ifdef MENU_FILENAME", '  CreateDirectory "$SMPROGRAMS\\${MENU_FILENAME}"', "!endif"],
            // Only if it's empty: the house's other apps share it.
            ["!ifdef MENU_FILENAME", '  RMDir "$SMPROGRAMS\\${MENU_FILENAME}"', "!endif"],
        ),
        // The finish page's Run, and --force-run: the Start menu shortcut, or the app itself without one.
        '  ${if} ${FileExists} "$newStartMenuLink"',
        '    StrCpy $launchLink "$newStartMenuLink"',
        "  ${else}",
        '    StrCpy $launchLink "$appExe"',
        "  ${endIf}",
    );
    if (contextMenu) {
        lines.push(
            '  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "KitContextMenu" "$KitMenu"',
            '  ${if} $KitMenu == "1"',
            ...menuKeys.flatMap((menuKey) => [
                `    WriteRegStr SHELL_CONTEXT "${menuKey}" "" "${nsisString(contextMenu.label)}"`,
                `    WriteRegStr SHELL_CONTEXT "${menuKey}" "Icon" '"$appExe",0'`,
                // Shown however many files are selected: each reaches the app (one instance gathers them).
                `    WriteRegStr SHELL_CONTEXT "${menuKey}" "MultiSelectModel" "Player"`,
                `    WriteRegStr SHELL_CONTEXT "${menuKey}\\command" "" '${menuCommand}'`,
            ]),
            "  ${else}",
            ...menuKeys.map((menuKey) => `    DeleteRegKey SHELL_CONTEXT "${menuKey}"`),
            "  ${endIf}",
        );
    }
    lines.push("  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'", "!macroend");

    const removals = removeAll("    ");
    lines.push("", ...uninstall(removals.length > 0 ? [...removals, "    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'"] : []));
    return lines.join("\r\n") + "\r\n";
}

module.exports = { installerScript, nsisString, sectionCount, MAX_LABEL };
