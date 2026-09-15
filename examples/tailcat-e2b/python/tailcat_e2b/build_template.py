from dotenv import load_dotenv
from e2b import Template, default_build_logger

from .template import TEMPLATE_ALIAS, tailcat_template


def main() -> None:
    load_dotenv()
    build_info = Template.build(tailcat_template, alias=TEMPLATE_ALIAS, on_build_logs=default_build_logger())
    print(f"built template {TEMPLATE_ALIAS}: {build_info}")


if __name__ == "__main__":
    main()
