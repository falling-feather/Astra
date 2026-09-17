const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DECLARATION_PATHS, declarationBoundaryViolations } = require('../quality/declaration-boundaries.cjs');

for (const relativePath of DECLARATION_PATHS) {
  const source = fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');
  assert.deepEqual(declarationBoundaryViolations(relativePath, source), [],
    `${relativePath} must remain declarations and pure field validation`);
  for (const code of [
    'from app.services import grading\n',
    'def grade():\n    from app.services import grading\n',
    'def grade():\n    from ..services import grading\n',
    'from app import (\n    services,\n)\n',
    'from .. import (\n    services,\n)\n',
    'from app.models.base import Base; from app.services import grading\n',
  ]) {
    assert.ok(declarationBoundaryViolations(relativePath, code).includes('cross-layer-import'),
      `${relativePath} must reject service dependencies, including nested/multiline imports: ${code}`);
  }
  for (const code of ['db.commit()', 'session.execute(statement)', 'httpx.post(endpoint)', 'open(filename, "w")',
    'db.add(value)', 'Path("config.json").read_text()']) {
    assert.ok(declarationBoundaryViolations(relativePath, code).includes('io-authority'),
      `${relativePath} must not take over persistence/network/filesystem effects: ${code}`);
  }
  assert.deepEqual(declarationBoundaryViolations(relativePath,
    '# requests.get(endpoint)\ndescription: str = Field(description="Maximum requests per second")\n'), [],
  'documentation strings and comments must not be mistaken for I/O');
}
assert.deepEqual(declarationBoundaryViolations('backend/app/models/course.py',
  'from app.models.base import Base\nclass Course(Base):\n    revision: Mapped[int] = mapped_column(Integer, default=1)\n'), [],
  'adding persistence fields must not be confused with adding business orchestration');
assert.deepEqual(declarationBoundaryViolations('backend/app/schemas/course.py',
  'from app.schemas.school import ClassRead\nclass SubmissionCreate(BaseModel):\n    expected_submission_revision: int | None = None\n'), [],
  'adding transport concurrency fields must remain an allowed DTO change');
console.log('declaration-boundaries-contract: ok');
