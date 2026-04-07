import re, os, sys

# Scrivi keystore.properties
with open('android/keystore.properties', 'w') as f:
    f.write('storeFile=../../burraco.keystore\n')
    f.write('storePassword=burraco123\n')
    f.write('keyAlias=burraco\n')
    f.write('keyPassword=burraco123\n')

# Leggi build.gradle
with open('android/app/build.gradle', 'r') as f:
    content = f.read()

# Aggiungi lettura keystore.properties prima del resto
props_block = (
    "def keystoreProps = new Properties()\n"
    "def keystoreFile = rootProject.file('keystore.properties')\n"
    "if (keystoreFile.exists()) { keystoreProps.load(new FileInputStream(keystoreFile)) }\n\n"
)
if 'keystoreProps' not in content:
    content = props_block + content

# Aggiungi signingConfigs prima di buildTypes
signing_config = (
    "\n    signingConfigs {\n"
    "        release {\n"
    "            storeFile keystoreProps['storeFile'] ? file(keystoreProps['storeFile']) : null\n"
    "            storePassword keystoreProps['storePassword']\n"
    "            keyAlias keystoreProps['keyAlias']\n"
    "            keyPassword keystoreProps['keyPassword']\n"
    "        }\n"
    "    }\n"
)
if 'signingConfigs' not in content:
    content = content.replace('    buildTypes {', signing_config + '    buildTypes {')

# Aggiungi signingConfig alla release buildType
if 'signingConfig signingConfigs.release' not in content:
    content = re.sub(
        r'(buildTypes\s*\{[^}]*release\s*\{)',
        r'\1\n                signingConfig signingConfigs.release',
        content, flags=re.DOTALL
    )

with open('android/app/build.gradle', 'w') as f:
    f.write(content)

print("build.gradle configurato OK")
