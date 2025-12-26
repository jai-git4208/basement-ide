#include <errno.h>
#include <grp.h>
#include <pwd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <unistd.h>

int main(int argc, char *argv[]) {
  if (argc < 4) {
    fprintf(stderr, "Usage: %s <rootfs> <uid> <command> [args...]\n", argv[0]);
    return 1;
  }

  char *rootfs = argv[1];
  uid_t target_uid = (uid_t)atoi(argv[2]);
  char *command = argv[3];

#ifdef __APPLE__

  char *macos_dev_mode = getenv("MACOS_DEV_MODE");
  if (macos_dev_mode != NULL && strcmp(macos_dev_mode, "1") == 0) {
    fprintf(stderr, "⚠️  macOS DEV MODE: Skipping chroot (SIP limitation)\n");
    fprintf(stderr, "    Executing directly for development/testing only\n");

    char **exec_args = &argv[3];
    if (execvp(command, exec_args) == -1) {
      perror("execvp failed");
      return 1;
    }
    return 0;
  }
#endif

  struct passwd *pw = getpwuid(target_uid);
  if (pw == NULL) {
    fprintf(stderr, "Error: User with UID %d not found.\n", target_uid);
    return 1;
  }

  if (chroot(rootfs) != 0) {
    perror("chroot failed (are you root?)");
#ifdef __APPLE__
    fprintf(stderr, "\nmacOS TIP: Due to SIP, chroot may not work properly.\n");
    fprintf(stderr, "Set MACOS_DEV_MODE=1 environment variable to skip chroot "
                    "for testing.\n");
#endif
    return 1;
  }

  if (chdir("/") != 0) {
    perror("chdir failed");
    return 1;
  }

  if (initgroups(pw->pw_name, pw->pw_gid) != 0) {
    perror("initgroups failed");
    return 1;
  }

  if (setgid(pw->pw_gid) != 0) {
    perror("setgid failed");
    return 1;
  }

  if (setuid(target_uid) != 0) {
    perror("setuid failed");
    return 1;
  }

  if (getuid() == 0 || geteuid() == 0) {
    fprintf(stderr, "Error: Failed to drop root privileges!\n");
    return 1;
  }

  char **exec_args = &argv[3];

  if (execvp(command, exec_args) == -1) {
    perror("execvp failed");
    return 1;
  }

  return 0;
}
