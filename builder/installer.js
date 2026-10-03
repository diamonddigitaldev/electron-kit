"use strict";

// The asking installer: the NSIS include config() gives electron-builder, made
// from the app's file types and right-click entry. It never claims a file type
// or adds a right-click entry without asking (WORKQUEUE 8d):
//
// - who it's for: electron-builder's own page, "Only for me" (no
//   administrator prompt) or everyone. If the app is already installed for
//   everyone, the page is skipped and that copy is upgraded, so an install
//   from before the kit (which was always for everyone) never becomes two;
// - the files it opens: a page after it, with a box per extension, in the
//   app's groups, all ticked, "Tick All" and "Untick All", and a ticked box
//   for the right-click entry. An app that takes any file (allFiles) has the
//   right-click box only;
// - a ticked type: the app is in its Open With list, and it's listed as an
//   app in Windows' Default apps (Capabilities, RegisteredApplications). It
//   becomes the type's default only where no app has been chosen: Windows
//   keeps each person's own choice (UserChoice) where no installer can write
//   it, and another app's default is never taken. An unticked type gets
//   nothing, and what an earlier install added for it is taken away;
// - the choices are kept with the install, and the next install starts from
//   them: an update (silent, run by the updater) never adds back what was
//   unticked. Silently, /FILETYPES=all, none or a list (txt,md) and
//   /NOCONTEXTMENU choose instead;
// - uninstalling takes away everything it added; an update's uninstall of
//   the version before it (--updated) takes away nothing.
//
// electron-builder builds it with makensis -WX: a warning fails the build, so
// what the uninstaller doesn't use is never compiled into it.

/** The most file types the page shows: four columns of eight. */
const MAX_COLUMNS = 4;
const ROWS = 8;

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

/** The columns the page lays the file types out in: each group's, eight to a column. */
function columnsOf(fileTypes) {
    const columns = [];
    for (const group of fileTypes) {
        for (let start = 0; start < group.ext.length; start += ROWS) {
            columns.push({ heading: start === 0 ? group.name : "", ext: group.ext.slice(start, start + ROWS) });
        }
    }
    return columns;
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
    const columns = columnsOf(fileTypes);
    const hasPage = exts.length > 0 || contextMenu !== undefined;
    const capabilities = `Software\\Diamond Digital Development\\${key}\\Capabilities`;
    const menuKeys = contextMenu ? [`Software\\Classes\\*\\shell\\${key}`, ...(contextMenu.folders ? [`Software\\Classes\\Directory\\shell\\${key}`] : [])] : [];
    const menuCommand = contextMenu ? `"$appExe" "%1"${(contextMenu.args ?? []).map((arg) => ` ${arg}`).join("")}` : "";

    const lines = [
        "; Made by @diamonddigitaldev/electron-kit's config() (builder/installer.js). Don't edit: it's made afresh on every build.",
        "",
        // An install for everyone already there is upgraded, never joined by a second for one person.
        "!macro customInstallMode",
        "  !ifndef BUILD_UNINSTALLER",
        '    ${if} $hasPerMachineInstallation == "1"',
        '      StrCpy $isForceMachineInstall "1"',
        "    ${endIf}",
        "  !endif",
        "!macroend",
    ];

    if (!hasPage) return lines.join("\r\n") + "\r\n";

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

    // The page, its state and what installing does with it: the installer's alone.
    lines.push(
        "",
        "!macro customPageAfterChangeDir",
        ...exts.flatMap((_, i) => [`  Var KitBox${i}`, `  Var KitType${i}`]),
        ...(contextMenu ? ["  Var KitMenuBox", "  Var KitMenu"] : []),
        "",
        "  Page custom KitFilesPage KitFilesPageLeave",
        "",
        "  Function KitFilesPage",
        "    ${if} ${isUpdated}",
        "      Abort",
        "    ${endIf}",
    );
    if (exts.length > 0) {
        lines.push(
            `    !insertmacro MUI_HEADER_TEXT "Choose File Types" "Choose which files ${product} opens."`,
            "    nsDialogs::Create 1018",
            "    Pop $R0",
            `    \${NSD_CreateLabel} 0u 0u 100% 24u "Add ${product} to Open With for the file types ticked below. It opens them by default only where you haven't already chosen an app, which you can change in Settings > Apps > Default apps."`,
            "    Pop $R0",
        );
        const width = Math.floor(300 / columns.length);
        let i = 0;
        columns.forEach((column, c) => {
            const x = c * width;
            if (column.heading) lines.push(`    \${NSD_CreateLabel} ${x}u 28u ${width - 4}u 9u "${controlText(column.heading)}"`, "    Pop $R0");
            column.ext.forEach((ext, row) => {
                lines.push(
                    `    \${NSD_CreateCheckbox} ${x}u ${38 + row * 9}u ${width - 4}u 9u ".${ext}"`,
                    `    Pop $KitBox${i}`,
                    `    \${if} $KitType${i} == "1"`,
                    `      \${NSD_Check} $KitBox${i}`,
                    "    ${endIf}",
                );
                i++;
            });
        });
        lines.push(
            '    ${NSD_CreateButton} 0u 113u 50u 13u "Tick All"',
            "    Pop $R0",
            "    ${NSD_OnClick} $R0 KitTickAll",
            '    ${NSD_CreateButton} 54u 113u 56u 13u "Untick All"',
            "    Pop $R0",
            "    ${NSD_OnClick} $R0 KitUntickAll",
        );
    } else {
        lines.push(
            `    !insertmacro MUI_HEADER_TEXT "Right-Click Menu" "Choose whether ${product} is on the menu when you right-click a file."`,
            "    nsDialogs::Create 1018",
            "    Pop $R0",
        );
    }
    if (contextMenu) {
        const where = contextMenu.folders ? "files and folders" : "files";
        lines.push(
            `    \${NSD_CreateCheckbox} 0u ${exts.length > 0 ? 129 : 0}u 100% 10u "Add $\\"${controlText(contextMenu.label)}$\\" to the menu when you right-click ${where}"`,
            "    Pop $KitMenuBox",
            '    ${if} $KitMenu == "1"',
            "      ${NSD_Check} $KitMenuBox",
            "    ${endIf}",
        );
    }
    lines.push(
        "    nsDialogs::Show",
        "  FunctionEnd",
        "",
        "  Function KitFilesPageLeave",
        ...exts.flatMap((_, i) => [`    \${NSD_GetState} $KitBox${i} $KitType${i}`]),
        ...(contextMenu ? ["    ${NSD_GetState} $KitMenuBox $KitMenu"] : []),
        "  FunctionEnd",
    );
    if (exts.length > 0) {
        for (const [name, check] of [["KitTickAll", "NSD_Check"], ["KitUntickAll", "NSD_Uncheck"]]) {
            lines.push("", `  Function ${name}`, "    Pop $R0", ...exts.map((_, i) => `    \${${check}} $KitBox${i}`), "  FunctionEnd");
        }
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

    // Before any page: the last install's choices, else every box ticked; then the command line's.
    lines.push("", "!macro customInit", "  ${GetParameters} $R0");
    if (exts.length > 0) {
        lines.push(
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
                `  ReadRegStr $KitType${i} SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" "KitFileType.${ext}"`,
                "  ${if} ${Errors}",
                `    StrCpy $KitType${i} "1"`,
                "  ${endIf}",
                '  ${if} $R1 == ",all,"',
                `    StrCpy $KitType${i} "1"`,
                '  ${elseIf} $R1 == ",none,"',
                `    StrCpy $KitType${i} "0"`,
                '  ${elseIf} $R1 != ""',
                "    Push $R1",
                `    Push ",${ext},"`,
                "    Call KitListHas",
                `    Pop $KitType${i}`,
                "  ${endIf}",
            );
        });
    }
    if (contextMenu) {
        lines.push(
            "  ClearErrors",
            '  ReadRegStr $KitMenu SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "KitContextMenu"',
            "  ${if} ${Errors}",
            '    StrCpy $KitMenu "1"',
            "  ${endIf}",
            "  ClearErrors",
            '  ${GetOptions} $R0 "/NOCONTEXTMENU" $R1',
            "  ${ifNot} ${Errors}",
            '    StrCpy $KitMenu "0"',
            "  ${endIf}",
        );
    }
    lines.push("!macroend");

    // After the app's files: what's ticked is added, what isn't is taken away, and the choices kept.
    lines.push("", "!macro customInstall");
    if (exts.length > 0) {
        lines.push(
            '  StrCpy $R8 "0"',
            ...exts.flatMap((ext, i) => [
                `  WriteRegStr SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" "KitFileType.${ext}" "$KitType${i}"`,
                `  \${if} $KitType${i} == "1"`,
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

    // Uninstalling takes away everything it may have added; an update's uninstall, nothing.
    lines.push(
        "",
        "!macro customUnInstall",
        "  ${ifNot} ${isUpdated}",
        ...removeAll("    "),
        "    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'",
        "  ${endIf}",
        "!macroend",
    );
    return lines.join("\r\n") + "\r\n";
}

module.exports = { installerScript, columnsOf, nsisString, MAX_COLUMNS, ROWS };
