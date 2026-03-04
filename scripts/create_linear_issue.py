import subprocess

def create_linear_issue():
    args = [
        "linear",
        '--team', 'default',
        '--title', 'Test Issue',
        '--description', 'This is a test issue created via automation.'
    ]
    subprocess.run(args, check=True)

create_linear_issue()