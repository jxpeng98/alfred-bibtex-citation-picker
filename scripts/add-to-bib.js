#!/usr/bin/env osascript -l JavaScript

function run(argv) {

	// ----------------------
	// JXA & Alfred specific
	// ----------------------
	ObjC.import("stdlib");
	ObjC.import("Foundation");
	const app = Application.currentApplication();
	app.includeStandardAdditions = true;
	const newLineDelimiter = "\r"; // must be /r instead of /n because JXA

	function appendToFile(text, absPath) {
		text = text.replaceAll("'", "`"); // ' in text string breaks echo writing method
		app.doShellScript(`echo '${text}' >> '${absPath}'`); // use single quotes to prevent running of input such as "$(rm -rf /)"
	}

	function readFile(path, encoding) {
		if (!encoding) encoding = $.NSUTF8StringEncoding;
		const fm = $.NSFileManager.defaultManager;
		const data = fm.contentsAtPath(path);
		const str = $.NSString.alloc.initWithDataEncoding(data, encoding);
		return ObjC.unwrap(str);
	}

	function writeToFile(text, file) {
		const str = $.NSString.alloc.initWithUTF8String(text);
		str.writeToFileAtomicallyEncodingError(file, true, $.NSUTF8StringEncoding, null);
	}

	//---------------------------------------------------------------------------


	function generateCitekey(bibtexPropertyArr) {
		function parseBibtexProperty(arr, property) {
			arr = arr
				.map(line => line.trim())
				.filter(p => p.startsWith(property + " "));
			if (!arr.length) return "";
			const value = arr[0]
				.split("=")[1]
				.replace(/{|}|,$/g, "")
				.trim();
			return value;
		}

		let year = parseBibtexProperty(bibtexPropertyArr, "year");
		if (!year) year = "ND";

		let authEds;
		const authors = parseBibtexProperty(bibtexPropertyArr, "author");
		const editors = parseBibtexProperty(bibtexPropertyArr, "editor");
		if (authors) authEds = authors;
		else if (editors) authEds = editors;
		else authEds = "NoAuthor";

		let authorStr;
		if (authEds === "NoAuthor") authorStr = authEds;
		else {
			const lastNameArr = authEds
				.split(" and ") // "and" used as delimiter in bibtex for names
				.map(name => {
					if (name.includes(",")) return name.split(",")[0].trim(); // ottobib returns "last name - first name"
					return name.split(" ").pop(); // doi.org returns "first name - last name"
				});

			if (lastNameArr.length < 3) authorStr = lastNameArr.join("");
			else authorStr = lastNameArr[0] + "EtAl";
		}

		// strip diacritics from authorStr
		authorStr = authorStr
			.replace(/ä|á|â|à|ã/g, "a")
			.replace(/Ä|Á|Â|À|Ã/g, "A")
			.replace(/ö|ó|ô|õ|ò|ø/g, "o")
			.replace(/Ö|Ó|Ô|Õ|Ò|Ø/g, "O")
			.replace(/ü|ú|û|ù/g, "u")
			.replace(/Ü|Ú|Û|Ù/g, "U")
			.replace(/é|ê|è|ë/g, "e")
			.replace(/É|Ê|È|Ë/g, "E")
			.replace(/í|î|ì|ï/g, "i")
			.replace(/Í|Î|Ì|Ï/g, "I")
			.replace(/ç|ć|č/g, "c")
			.replace(/Ç|Ć|Č/g, "C")
			.replace(/ñ/g, "n");

		const citekey = authorStr + year;
		return citekey;
	}

	function ensureUniqueCitekey(citekey) {
		// check if citekey already exists
		const citekeyArray = readFile(libraryPath)
			.split("\n")
			.filter(line => line.startsWith("@"))
			.map(line => line.split("{")[1].replaceAll(",", ""));

		const alphabet = "abcdefghijklmnopqrstuvwxyz";
		let i = -1;
		let nextCitekey = citekey;
		while (citekeyArray.includes(nextCitekey)) {
			let nextLetter = alphabet[i];
			if (i === -1) nextLetter = ""; // first loop
			nextCitekey = citekey + nextLetter;
			i++;
			if (i > alphabet.length - 1) break; // in case the citekey is already used 27 times (lol)
		}
		return nextCitekey;
	}


	//───────────────────────────────────────────────────────────────────────────

	console.log("beep");
	const doiRegex = /10.\d{4,9}\/[-._;()/:A-Z0-9]+(?=$|[?/ ])/i; // https://www.crossref.org/blog/dois-and-matching-regular-expressions/
	const isbnRegex = /^[\d-]{9,}$/;
	const isEmptyRegex = /^\s*$/;

	const bibtexEntryTemplate = "@misc{NEW_ENTRY,\n\tauthor = {Doe, Jane},\n\ttitle = {NEW_ENTRY},\n\tpages = {1--1},\n\tyear = 0000\n}\n";
	const fieldsToDelete = ["date", "ean", "month", "issn", "language", "copyright"];

	const input = argv.join("").trim();
	const libraryPath = $.getenv("bibtex_library_path").replace(/^~/, app.pathTo("home folder"));
	//---------------------------------------------------------------------------

	let bibtexEntry;
	let newEntry;
	let newCitekey;

	// type of reading to perform
	console.log("beep");
	let parseSelection;
	try {
		parseSelection = $.getenv("parsing") === "true";
	} catch (error) {
		parseSelection = false;
	}
	const isDOI = doiRegex.test(input);
	const isISBN = isbnRegex.test(input);
	const isEmpty = isEmptyRegex.test(input);
	if (!isDOI && !isISBN && !isEmpty && !parseSelection) return "ERROR";

	if (isDOI) {
		console.log("isDOI: " + isDOI);
		const doiURL = "https://doi.org/" + input.match(doiRegex)[0];
		bibtexEntry = app.doShellScript(`curl -sLH "Accept: application/x-bibtex" "${doiURL}"`); // https://citation.crosscite.org/docs.html
		if (!bibtexEntry.includes("@")) return "ERROR";

	} else if (isISBN) {
		const isbn = input;
		bibtexEntry = app.doShellScript(`curl -sHL "https://www.ebook.de/de/tools/isbn2bibtex?isbn=${isbn}"`);
		if (bibtexEntry.includes("Not found")) return "not found";
		if (!bibtexEntry.includes("@")) return "ERROR";
		bibtexEntry = bibtexEntry
			.replace(/^\s+\w+ =/m, (field) => field.toLowerCase()) // lowercase fields
			.replace(/^(\tpagetotal = {\d+) Seiten/m, "$1"); // remove German page word

	} else if (parseSelection) {
		// anystyle can't read STDIN, so this has to be written to a file
		// https://github.com/inukshuk/anystyle-cli#anystyle-help-parse
		const tempPath = $.getenv("alfred_workflow_cache") + "/temp.txt";
		writeToFile(input, tempPath);
		bibtexEntry = app.doShellScript(`anystyle --stdout -f bib parse "${tempPath}"`)
			.replaceAll("\tdate =", "\tyear ="); // consistently "year"

	} else if (isEmpty) {
		newEntry = bibtexEntryTemplate;
		newCitekey = "NEW_ENTRY";
		appendToFile(newEntry, libraryPath);
		return newCitekey; // pass for opening function
	}

	// insert content to append
	bibtexEntry = bibtexEntry.replaceAll("  ", "\t"); // add proper indentation
	let newEntryProperties = bibtexEntry.split(newLineDelimiter);

	// clean up fields
	newEntryProperties = newEntryProperties
		.filter(property => {
			const field = property.replace(/^\s*(\w+) ?=.*/, "$1");
			console.log("field: " + field);
			return !fieldsToDelete.includes(field);
		});

	// Generate citekey
	newCitekey = generateCitekey(newEntryProperties);
	newCitekey = ensureUniqueCitekey(newCitekey);
	newEntryProperties[0] = newEntryProperties[0].split("{")[0] + "{" + newCitekey + ",";

	// Create keywords field
	newEntryProperties.splice(1, 0, "\tkeywords = {},");

	newEntry = newEntryProperties.join("\n");

	appendToFile(newEntry, libraryPath);
	return newCitekey; // pass for opening function
}
