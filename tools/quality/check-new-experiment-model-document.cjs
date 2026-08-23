const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_CONTRACT_FILE = path.join(
    DEFAULT_ROOT,
    'tools/templates/new-experiment/model-document.contract.json'
);

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cleanCell = (value) => String(value || '')
    .trim()
    .replace(/^`|`$/g, '')
    .replace(/^\*\*|\*\*$/g, '');

function loadContract(file = DEFAULT_CONTRACT_FILE) {
    const contract = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (contract.schema_version !== 1 || contract.task !== 'EXT-05') {
        throw new Error('Unsupported model-document contract');
    }
    return contract;
}

function addError(errors, code, message) {
    errors.push(Object.freeze({ code, message }));
}

function forbiddenMarker(value, contract) {
    return contract.forbidden_markers.find((pattern) => new RegExp(pattern, 'i').test(String(value || ''))) || '';
}

function extractAnchoredBlock(markdown, anchor, errors) {
    const marker = `<a id="${anchor}"></a>`;
    const occurrences = String(markdown || '').split(marker).length - 1;
    if (occurrences !== 1) {
        addError(
            errors,
            occurrences === 0 ? 'anchor_missing' : 'anchor_duplicate',
            `model document must contain exactly one explicit ${marker}`
        );
        return '';
    }

    const start = markdown.indexOf(marker);
    const remainder = markdown.slice(start + marker.length);
    const firstHeading = remainder.search(/^###\s+/m);
    if (firstHeading < 0) {
        addError(errors, 'title_heading_missing', 'explicit model anchor must be followed by a level-three title');
        return marker;
    }
    const afterFirstHeading = remainder.slice(firstHeading + 4);
    const nextHeading = afterFirstHeading.search(/^###\s+/m);
    const end = nextHeading < 0
        ? markdown.length
        : start + marker.length + firstHeading + 4 + nextHeading;
    return markdown.slice(start, end).trim();
}

function extractSection(block, heading) {
    const pattern = new RegExp(`^####\\s+${escapeRegExp(heading)}\\s*$`, 'm');
    const match = pattern.exec(block);
    if (!match) return '';
    const start = match.index + match[0].length;
    const remainder = block.slice(start);
    const next = remainder.search(/^####\s+/m);
    return (next < 0 ? remainder : remainder.slice(0, next)).trim();
}

function splitTableRow(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed.startsWith('|')) return [];
    return trimmed
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim());
}

function parseTable(section, expectedColumns) {
    const lines = section.split(/\r?\n/);
    for (let index = 0; index < lines.length - 1; index += 1) {
        const header = splitTableRow(lines[index]);
        if (header.length !== expectedColumns.length) continue;
        if (!header.every((cell, column) => cleanCell(cell) === expectedColumns[column])) continue;
        const separator = splitTableRow(lines[index + 1]);
        if (
            separator.length !== expectedColumns.length
            || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))
        ) continue;

        const rows = [];
        for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
            if (!lines[rowIndex].trim().startsWith('|')) break;
            rows.push(splitTableRow(lines[rowIndex]));
        }
        return { found: true, rows };
    }
    return { found: false, rows: [] };
}

function metadataValue(block, label) {
    const match = new RegExp(`^- \\*\\*${escapeRegExp(label)}\\*\\*：\\s*(.+)$`, 'm').exec(block);
    return match ? match[1].trim() : '';
}

function validateModelDocument({ markdown, anchor, subject, id, title, contract = loadContract() }) {
    const errors = [];
    const expectedAnchor = `model-${id}`;
    if (anchor !== expectedAnchor) {
        addError(errors, 'anchor_identity_mismatch', `model anchor must equal ${expectedAnchor}`);
    }

    const block = extractAnchoredBlock(String(markdown || ''), anchor, errors);
    if (!block) return Object.freeze({ ok: false, errors: Object.freeze(errors), stats: Object.freeze({}) });

    const heading = /^###\s+(.+)$/m.exec(block);
    const expectedHeading = `${title}｜模型说明与验证记录`;
    if (!heading || heading[1].trim() !== expectedHeading) {
        addError(errors, 'title_identity_mismatch', `model heading must equal ${expectedHeading}`);
    }

    for (const label of contract.required_metadata) {
        const value = metadataValue(block, label);
        if (!value) addError(errors, 'metadata_missing', `required metadata is missing: ${label}`);
    }
    const identity = cleanCell(metadataValue(block, '实验身份'));
    if (identity !== `${subject}.${id}`) {
        addError(errors, 'experiment_identity_mismatch', `实验身份 must equal ${subject}.${id}`);
    }
    if (cleanCell(metadataValue(block, '复核状态')) !== contract.approved_review_status) {
        addError(errors, 'review_status_unapproved', `复核状态 must equal ${contract.approved_review_status}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanCell(metadataValue(block, '复核日期')))) {
        addError(errors, 'review_date_invalid', '复核日期 must use YYYY-MM-DD');
    }

    for (const marker of contract.forbidden_markers) {
        if (new RegExp(marker, 'i').test(block)) {
            addError(errors, 'unresolved_marker', `model document still contains forbidden marker: ${marker}`);
        }
    }
    for (const forbiddenHeading of contract.forbidden_section_headings) {
        if (new RegExp(`^#{1,6}\\s+.*${escapeRegExp(forbiddenHeading)}.*$`, 'mi').test(block)) {
            addError(errors, 'course_section_forbidden', `model document must not contain course section: ${forbiddenHeading}`);
        }
    }

    const sections = new Map();
    for (const sectionName of contract.required_sections) {
        const section = extractSection(block, sectionName);
        if (!section) addError(errors, 'section_missing', `required section is missing: ${sectionName}`);
        sections.set(sectionName, section);
    }

    for (const [sectionName, labels] of Object.entries(contract.required_statements || {})) {
        const section = sections.get(sectionName) || '';
        for (const label of labels) {
            const value = metadataValue(section, label);
            if (!value || forbiddenMarker(value, contract)) {
                addError(errors, 'statement_missing', `${sectionName} must contain a completed ${label} statement`);
            }
        }
    }

    const tableRows = new Map();
    for (const tableContract of contract.tables) {
        const section = sections.get(tableContract.section) || '';
        const table = parseTable(section, tableContract.columns);
        if (!table.found) {
            addError(errors, 'table_missing', `required table is missing or has wrong columns: ${tableContract.section}`);
            tableRows.set(tableContract.section, []);
            continue;
        }
        tableRows.set(tableContract.section, table.rows);
        if (table.rows.length < tableContract.minimum_rows) {
            addError(
                errors,
                'table_rows_insufficient',
                `${tableContract.section} requires at least ${tableContract.minimum_rows} data rows`
            );
        }
        for (const row of table.rows) {
            if (
                row.length !== tableContract.columns.length
                || row.some((cell) => !cleanCell(cell) || forbiddenMarker(cell, contract))
            ) {
                addError(errors, 'table_row_incomplete', `${tableContract.section} contains an incomplete data row`);
            }
        }
        const firstColumn = new Set(table.rows.map((row) => cleanCell(row[0])));
        for (const requiredValue of tableContract.required_first_column_values || []) {
            if (!firstColumn.has(requiredValue)) {
                addError(errors, 'table_required_row_missing', `${tableContract.section} must contain row ${requiredValue}`);
            }
        }
    }

    const variableTable = contract.tables.find((item) => item.section.startsWith('2. '));
    const variableRows = tableRows.get(variableTable?.section) || [];
    const roleIndex = variableTable?.columns.indexOf('角色') ?? -1;
    const unitIndex = variableTable?.columns.indexOf('SI 单位') ?? -1;
    const roles = new Set(variableRows.map((row) => cleanCell(row[roleIndex])));
    for (const role of contract.required_variable_roles) {
        if (!roles.has(role)) addError(errors, 'variable_role_missing', `variable table must contain role ${role}`);
    }
    if (unitIndex >= 0 && variableRows.some((row) => !cleanCell(row[unitIndex]) || forbiddenMarker(row[unitIndex], contract))) {
        addError(errors, 'si_unit_missing', 'every variable row must declare an SI unit or 1 for dimensionless values');
    }

    const equationSection = sections.get('3. 核心关系与符号约定') || '';
    const equations = [...equationSection.matchAll(/\$\$([\s\S]*?)\$\$/g)]
        .map((match) => match[1].trim())
        .filter((value) => value && !forbiddenMarker(value, contract));
    if (equations.length < contract.minimum_equation_blocks) {
        addError(errors, 'equation_missing', `at least ${contract.minimum_equation_blocks} completed equation block is required`);
    }

    const referencesSection = sections.get('10. 参考依据') || '';
    const references = [...referencesSection.matchAll(/^- \[(R\d+)\]\s+(.+)$/gm)]
        .map((match) => ({ id: match[1], value: match[2].trim() }));
    if (references.length < contract.minimum_references) {
        addError(errors, 'references_insufficient', `at least ${contract.minimum_references} references are required`);
    }
    if (new Set(references.map((item) => item.id)).size !== references.length) {
        addError(errors, 'reference_duplicate', 'reference identifiers must be unique');
    }
    const beforeReferences = block.split(/^####\s+10\. 参考依据\s*$/m, 1)[0];
    for (const reference of references) {
        if (reference.value.split('；').length < contract.minimum_reference_fields) {
            addError(
                errors,
                'reference_fields_incomplete',
                `${reference.id} must include source, title, version/section, publisher/URL and date`
            );
        }
        if (!beforeReferences.includes(`[${reference.id}]`)) {
            addError(errors, 'reference_unused', `${reference.id} must be cited before the reference section`);
        }
    }

    const reviewSection = sections.get('11. 发布前复核') || '';
    for (const item of contract.required_review_items) {
        if (!new RegExp(`^- \\[x\\]\\s+${escapeRegExp(item)}\\s*$`, 'mi').test(reviewSection)) {
            addError(errors, 'review_item_unchecked', `release review item must be checked: ${item}`);
        }
    }

    const validationRows = tableRows.get('7. 可复核样例') || [];
    return Object.freeze({
        ok: errors.length === 0,
        errors: Object.freeze(errors),
        stats: Object.freeze({
            sections: contract.required_sections.length,
            variableRows: variableRows.length,
            validationCases: validationRows.length,
            references: references.length
        })
    });
}

function resolveModelReference(root, value) {
    const reference = String(value || '').trim();
    const firstHash = reference.indexOf('#');
    if (firstHash <= 0 || reference.indexOf('#', firstHash + 1) >= 0) {
        return { ok: false, reason: 'model_document must contain one relative Markdown path and one fragment' };
    }
    const relative = reference.slice(0, firstHash);
    const anchor = reference.slice(firstHash + 1);
    if (
        !relative.startsWith('doc/')
        || !relative.endsWith('.md')
        || relative.includes('\\')
        || path.isAbsolute(relative)
    ) {
        return { ok: false, reason: 'model_document must point to a forward-slash Markdown path inside doc/' };
    }
    const repositoryRoot = path.resolve(root);
    const absolute = path.resolve(repositoryRoot, relative.replaceAll('/', path.sep));
    const prefix = repositoryRoot.endsWith(path.sep) ? repositoryRoot : `${repositoryRoot}${path.sep}`;
    if (!absolute.startsWith(prefix)) {
        return { ok: false, reason: 'model_document resolves outside the repository root' };
    }
    return { ok: true, relative, absolute, anchor };
}

function validateModelDocumentReference({ manifest, root = DEFAULT_ROOT, contract = loadContract() }) {
    const errors = [];
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        addError(errors, 'manifest_invalid', 'manifest must be an object');
        return Object.freeze({ ok: false, errors: Object.freeze(errors), stats: Object.freeze({}) });
    }
    const reference = resolveModelReference(root, manifest.model_document);
    if (!reference.ok) {
        addError(errors, 'reference_invalid', reference.reason);
        return Object.freeze({ ok: false, errors: Object.freeze(errors), stats: Object.freeze({}) });
    }
    if (!fs.existsSync(reference.absolute) || !fs.statSync(reference.absolute).isFile()) {
        addError(errors, 'document_missing', `model document file does not exist: ${reference.relative}`);
        return Object.freeze({ ok: false, errors: Object.freeze(errors), stats: Object.freeze({}) });
    }
    const result = validateModelDocument({
        markdown: fs.readFileSync(reference.absolute, 'utf8'),
        anchor: reference.anchor,
        subject: String(manifest.subject || ''),
        id: String(manifest.id || ''),
        title: String(manifest.title || ''),
        contract
    });
    return Object.freeze({
        ok: result.ok,
        errors: result.errors,
        stats: result.stats,
        reference: Object.freeze({ relative: reference.relative, anchor: reference.anchor })
    });
}

function parseCli(argv) {
    let root = DEFAULT_ROOT;
    let manifest = '';
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--root') root = path.resolve(argv[++index] || '');
        else if (argument === '--manifest') manifest = path.resolve(argv[++index] || '');
        else if (argument === '--help') return { help: true, root, manifest };
        else throw new Error(`Unknown argument: ${argument}`);
    }
    return { help: false, root, manifest };
}

function runCli(argv = process.argv.slice(2)) {
    const options = parseCli(argv);
    if (options.help) {
        console.log('Usage: node tools/quality/check-new-experiment-model-document.cjs --manifest <manifest.json> [--root <repository>]');
        return 0;
    }
    if (!options.manifest) throw new Error('--manifest is required');
    if (!fs.existsSync(options.manifest)) throw new Error(`manifest does not exist: ${options.manifest}`);
    const manifest = JSON.parse(fs.readFileSync(options.manifest, 'utf8'));
    const result = validateModelDocumentReference({ manifest, root: options.root });
    if (!result.ok) {
        result.errors.forEach((error) => console.error(`${error.code}: ${error.message}`));
        return 1;
    }
    console.log(
        `new-experiment-model-document: ${manifest.subject}.${manifest.id} PASS; `
        + `${result.stats.sections} sections, ${result.stats.validationCases} validation cases, `
        + `${result.stats.references} references`
    );
    return 0;
}

module.exports = Object.freeze({
    loadContract,
    validateModelDocument,
    validateModelDocumentReference,
    resolveModelReference,
    runCli
});

if (require.main === module) {
    try {
        process.exitCode = runCli();
    } catch (error) {
        console.error(`new-experiment-model-document: ${error.message}`);
        process.exitCode = 1;
    }
}
