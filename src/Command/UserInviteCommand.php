<?php

declare(strict_types=1);

namespace App\Command;

use App\Exception\ApiException;
use App\Service\AuthService;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;

#[AsCommand(name: 'app:user:invite', description: 'Create or invite an externally verified account; print a single-use 48-hour activation token.')]
final class UserInviteCommand extends Command
{
    public function __construct(private readonly AuthService $auth)
    {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->addArgument('username', InputArgument::REQUIRED, 'Username whose ownership the operator has verified externally')
            ->addOption('admin', null, InputOption::VALUE_NONE, 'Create or promote an administrator; omission preserves an existing role')
            ->addOption('display-name', null, InputOption::VALUE_REQUIRED, 'Display name (existing value is preserved when omitted)')
            ->setHelp('Verify ownership outside the application before running this command. Share the printed token privately, never in a URL. Existing credentials are replaced when the invitation is activated. Inactive accounts must first be reactivated by an administrator.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        try {
            $result = $this->auth->invite($input->getArgument('username'), (bool) $input->getOption('admin'), $input->getOption('display-name'));
        } catch (ApiException $exception) {
            $io->error($exception->getMessage());

            return Command::FAILURE;
        }

        $output->writeln('Username: '.$result['user']['username'], OutputInterface::OUTPUT_RAW);
        $output->writeln('Role: '.$result['user']['role'], OutputInterface::OUTPUT_RAW);
        $output->writeln('Expires at: '.$result['expiresAt'], OutputInterface::OUTPUT_RAW);
        $output->writeln('Invitation token: '.$result['invitationToken'], OutputInterface::OUTPUT_RAW);
        $io->note('Shown once. Deliver privately after verifying ownership. Activation replaces the password and revokes all existing sessions.');

        return Command::SUCCESS;
    }
}
