cask "passforge" do
  version "12.1.0"
  # sha256 is filled in by release.yml when the homebrew-passforge tap is updated.
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/benforcapita/PassForge/releases/download/v#{version}/PassForge_#{version}_universal.dmg"
  name "PassForge"
  desc "Stateless password manager — frontends severed from the algorithm"
  homepage "https://github.com/benforcapita/PassForge"

  app "PassForge.app"

  postflight do
    system_command "#{appdir}/PassForge.app/Contents/MacOS/passforge-desktop",
                   args: ["--register-hosts"]
  end

  # Optional: remove the vault database and settings too.
  zap trash: "~/Library/Application Support/PassForge"

  caveats <<~EOS
    This build is ad-hoc signed (not notarized). On first launch macOS blocks it:
    open System Settings → Privacy & Security → Open Anyway, or run:
      xattr -dr com.apple.quarantine #{appdir}/PassForge.app
  EOS
end
