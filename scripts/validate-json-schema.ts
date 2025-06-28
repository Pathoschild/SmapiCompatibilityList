import * as ajv from "ajv";
import AjvErrors from 'ajv-errors';
import * as utilities from "./utilities";

// read args (format: `nodeExecutable scriptPath schemaPath jsonFilePath+`)
const schemaFilePath = process.argv[2];
const jsonFilePaths = process.argv.splice(3);

// load schema
let rawSchema: ajv.JSONSchemaType<unknown>;
try {
	rawSchema = utilities.loadJSONFile<ajv.JSONSchemaType<unknown>>(schemaFilePath);
}
catch (error) {
	console.error(`❌ Error loading schema from path '${schemaFilePath}': ${(error as Error)?.message ?? error}`);
	process.exit(1);
}

// load schema
const schema = new ajv.Ajv({
	allErrors: true,
	strictTypes: false // avoid error about the use of `anyOf { requires }`
});
AjvErrors(schema); // add support for 'errorMessages' extension to JSON Schema

// load schema validator
let validator: ajv.ValidateFunction<unknown>;
try {
	validator = schema.compile(rawSchema);
}
catch (error) {
	console.error(`❌ Error loading schema from path '${schemaFilePath}': ${(error as Error)?.message ?? error}`);
	process.exit(1);
}

// load & validate each data file
let passed = 0;
for (const jsonFilePath of jsonFilePaths) {
	// load JSON
	let data: unknown;
	try {
		data = utilities.loadJSONFile(jsonFilePath);
	}
	catch (error) {
		console.error(`❌ Error loading data: ${(error as Error)?.message ?? error}`);
		continue;
	}

	// validate
	if (validator(data))
		passed++;
	else {
		console.error(`❌ Input "${jsonFilePath}" did not match the provided schema:`);
		if (validator.errors) {
			for (const error of validator.errors)
				console.error(`   ${schema.errorsText([error])}`);
		}
	}
}

// log results
const finalSummary = `${passed} of ${jsonFilePaths.length} input files matched the provided schema.`;

if (passed < jsonFilePaths.length) {
	console.log("");
	console.log(`❌ ${finalSummary}`);
	process.exit(1);
}
else
	console.log(`✅ ${finalSummary}`);
