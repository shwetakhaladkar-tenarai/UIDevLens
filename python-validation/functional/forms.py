"""
functional/forms.py
Inspects forms for required-field markup problems and tests empty-state
validation using the browser's native Constraint Validation API
(HTMLFormElement.checkValidity()).

This NEVER submits a form, clicks a submit button, or calls form.submit() —
checkValidity() only evaluates the form's current field values against its
own constraint attributes; it cannot trigger navigation or a network
request, so it's always safe regardless of what the form does.
"""

from __future__ import annotations

from common.models import Finding, ValidationResult, mock_result

MAX_FORMS_CHECKED = 8

_FORM_JS = """
(forms) => forms.map((form, formIndex) => {
  const fields = Array.from(form.querySelectorAll('input, select, textarea'))
    .filter(el => el.type !== 'hidden' && el.type !== 'submit' && el.type !== 'button');

  const describeLabel = (el) => {
    if (el.id) {
      const lbl = form.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) return lbl.innerText.trim();
    }
    const closest = el.closest('label');
    if (closest) return closest.innerText.trim();
    return '';
  };

  const fieldInfo = fields.map((el, i) => {
    const label = describeLabel(el);
    const placeholder = el.getAttribute('placeholder') || '';
    const visualRequired = /\\*/.test(label) || /required/i.test(label) || /\\*/.test(placeholder);
    return {
      index: i,
      tag: el.tagName.toLowerCase(),
      type: el.type || null,
      name: el.getAttribute('name'),
      id: el.id || null,
      label,
      placeholder,
      hasRequiredAttr: el.hasAttribute('required'),
      ariaRequired: el.getAttribute('aria-required') === 'true',
      visualRequired,
      currentValueEmpty: !(el.value || '').trim(),
    };
  });

  let checkValidityResult = null;
  let checkValidityError = null;
  try {
    checkValidityResult = form.checkValidity();
  } catch (e) {
    checkValidityError = String(e);
  }

  return {
    formIndex,
    action: form.getAttribute('action') || null,
    method: (form.getAttribute('method') || 'get').toLowerCase(),
    fieldCount: fields.length,
    fields: fieldInfo,
    checkValidityResult,
    checkValidityError,
  };
});
"""


def validate(url: str, session=None, **_kwargs) -> ValidationResult:
    if session is None or getattr(session, "mocked", True):
        return mock_result(
            check="functional",
            source="forms",
            category="functional",
            title="Form validation (mocked)",
            description=f"Would inspect forms and validation states on {url}.",
            metrics={"formsChecked": 0, "mocked": True},
        )

    page = session.page
    if page is None:
        return ValidationResult(check="functional", warnings=["forms: no page available"], metrics={"formsChecked": 0})

    try:
        form_count = page.eval_on_selector_all("form", "els => els.length")
        forms_data = page.eval_on_selector_all("form", _FORM_JS) if form_count else []
    except Exception as exc:  # noqa: BLE001
        return ValidationResult(check="functional", errors=[f"forms: failed to inspect forms: {exc}"])

    forms_data = forms_data[:MAX_FORMS_CHECKED]
    findings: list[Finding] = []
    fields_checked = 0
    missing_required_count = 0

    for form in forms_data:
        for field in form["fields"]:
            fields_checked += 1
            if field["visualRequired"] and not field["hasRequiredAttr"] and not field["ariaRequired"]:
                missing_required_count += 1
                findings.append(
                    Finding(
                        id=f"functional-forms-missing-required-{len(findings) + 1}",
                        category="functional",
                        severity="medium",
                        title="Missing required-field validation",
                        description=(
                            f'Field "{field["label"] or field["name"] or field["placeholder"] or field["tag"]}" '
                            f'in form #{form["formIndex"]} appears required (its label/placeholder indicates it) '
                            'but has neither the HTML `required` attribute nor `aria-required="true"`, so the '
                            "browser will not block submission of an empty value."
                        ),
                        evidence={"formIndex": form["formIndex"], "field": field},
                        recommendation='Add the `required` attribute (or `aria-required="true"`) to this field.',
                        confidence=0.75,
                        source="python-functional",
                    )
                )

        # Empty-state validation: fields that are BOTH empty right now AND
        # marked required (by attribute) should make checkValidity() false.
        empty_required_fields = [f for f in form["fields"] if f["hasRequiredAttr"] and f["currentValueEmpty"]]
        if empty_required_fields and form["checkValidityResult"] is True:
            findings.append(
                Finding(
                    id=f"functional-forms-validation-bypass-{len(findings) + 1}",
                    category="functional",
                    severity="high",
                    title="Empty required fields do not block form validation",
                    description=(
                        f'Form #{form["formIndex"]} has {len(empty_required_fields)} empty field(s) marked '
                        "`required`, but the browser's native form validation (checkValidity()) reports the "
                        "form as valid. This form can likely be submitted without filling required fields."
                    ),
                    evidence={"formIndex": form["formIndex"], "emptyRequiredFields": empty_required_fields},
                    recommendation="Investigate why checkValidity() passes with empty required fields (e.g. a script clearing custom validity or removing the attribute).",
                    confidence=0.7,
                    source="python-functional",
                )
            )

    return ValidationResult(
        check="functional",
        findings=findings,
        metrics={
            "formsFound": len(forms_data),
            "formsChecked": len(forms_data),
            "fieldsChecked": fields_checked,
            "missingRequiredValidationCount": missing_required_count,
        },
    )
