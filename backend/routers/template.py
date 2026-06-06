from fastapi import APIRouter, HTTPException
from ..services.template_service import (
    list_templates, get_template, save_template, delete_template,
    apply_template, export_project_as_template,
)

router = APIRouter()


@router.get("/")
def list_all():
    return list_templates()


@router.get("/{name}")
def get_one(name: str):
    t = get_template(name)
    if not t:
        raise HTTPException(404, f"Template '{name}' not found")
    return t


@router.post("/")
def save(name: str = "", config: dict = None):
    if config is None:
        config = {}
    if name:
        config["name"] = name
    if "name" not in config:
        raise HTTPException(400, "Template name required")
    result = save_template(config)
    return result


@router.delete("/{name}")
def delete(name: str):
    return delete_template(name)


@router.post("/{name}/apply")
def apply(name: str, project_id: int):
    try:
        result = apply_template(project_id, name)
        return result
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/{name}/from-project/{project_id}")
def from_project(project_id: int, name: str):
    try:
        result = export_project_as_template(project_id, name)
        return result
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
